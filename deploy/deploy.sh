#!/usr/bin/env bash
# Spielt den aktuellen Stand eines Branches (Standard: main) auf dem Server ein.
# Aufruf auf dem Server als root:  /opt/airguard/src/deploy/deploy.sh [branch]
#
# Ablauf: bauen (App laeuft weiter) -> Dienst stoppen -> Datenbank und alte Version sichern
# -> neue Version einspielen -> starten -> pruefen. Schlaegt die Pruefung fehl, wird die
# alte Version samt Datenbank zurueckgespielt.
#
# Laeuft ein Einsatz, bricht das Skript ab (Exit-Code 2), damit kein Update mitten in einen
# Einsatz faellt. Erzwingen mit FORCE=1.
set -euo pipefail

SRC=/opt/airguard/src
BUILD=/opt/airguard/build
APP=/var/www/airguard/app
WEB=/var/www/airguard/web
BACKUPS=/root/backups
KEEP_BACKUPS=10
SERVICE=airguard

log() { echo "==> $*"; }

no_active_incident() {
  [ "${FORCE:-0}" = "1" ] && return 0
  local active
  active=$(python3 - "$APP/data/ats.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print(db.execute("select count(*) from Einsaetze where Status = 'aktiv'").fetchone()[0])
PY
)
  [ "$active" = "0" ] && return 0
  echo "Abbruch: $active laufende(r) Einsatz/Einsaetze. Nach Einsatzende erneut starten (oder FORCE=1)." >&2
  return 1
}

healthy() {
  # Geschuetzter Endpunkt: 401 heisst, das Backend laeuft und die Anmeldung greift.
  local code
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Proto: https' \
      'http://127.0.0.1:5114/api/einsaetze/letzte?limit=1' || true)
    [ "$code" = "401" ] && return 0
    sleep 1
  done
  echo "Backend antwortet nicht wie erwartet (letzter Status: ${code:-keiner})." >&2
  return 1
}

rollback() {
  local dir=$1
  log "Rueckfall auf die vorherige Version aus $dir"
  systemctl stop "$SERVICE" || true
  rsync -a --delete --exclude /data/ "$dir/app/" "$APP/"
  rsync -a --delete "$dir/data/" "$APP/data/"
  rsync -a --delete "$dir/web/" "$WEB/"
  systemctl start "$SERVICE"
  healthy && log "Vorherige Version laeuft wieder." || echo "Auch die vorherige Version startet nicht - bitte manuell pruefen." >&2
}

main() {
  local branch=${1:-main}

  no_active_incident || exit 2

  log "Hole $branch"
  git -C "$SRC" fetch --quiet origin "$branch"
  git -C "$SRC" reset --quiet --hard "origin/$branch"
  log "Stand: $(git -C "$SRC" log --oneline -1)"

  log "Baue Backend"
  rm -rf "$BUILD"
  dotnet publish "$SRC/backend" -c Release -o "$BUILD/backend" -nologo -v q

  log "Baue Frontend"
  (cd "$SRC/frontend" && NG_CLI_ANALYTICS=false npm ci --no-audit --no-fund && npx ng build)

  # Waehrend des Bauens kann ein Einsatz begonnen haben.
  no_active_incident || exit 2

  local dir
  dir="$BACKUPS/$(date +%Y-%m-%d_%H%M%S)"
  install -d -m 700 "$BACKUPS" "$dir"

  log "Stoppe Dienst und sichere nach $dir"
  systemctl stop "$SERVICE"
  rsync -a "$APP/data/" "$dir/data/"
  rsync -a --exclude /data/ "$APP/" "$dir/app/"
  rsync -a "$WEB/" "$dir/web/"

  log "Spiele neue Version ein"
  rsync -a --delete --exclude /data/ "$BUILD/backend/" "$APP/"
  rsync -a --delete "$SRC/frontend/dist/frontend/browser/" "$WEB/"
  systemctl start "$SERVICE"

  if ! healthy; then
    rollback "$dir"
    exit 1
  fi

  # Alte Sicherungen aufraeumen (enthalten personenbezogene Daten).
  ls -1dt "$BACKUPS"/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf --

  log "Fertig: $(git -C "$SRC" log --oneline -1)"
}

# main erst aufrufen, wenn bash das ganze Skript gelesen hat: git reset kann diese Datei
# waehrend des Laufs ersetzen.
main "$@"
exit
