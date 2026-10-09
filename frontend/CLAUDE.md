# Atemschutzüberwachung (Angular)

Webanwendung zur Überwachung von Atemschutztrupps bei Feuerwehreinsätzen und -übungen.
Bedient wird sie im Einsatz auf Tablets und Smartphones, oft mit Handschuhen, unter Stress,
bei Sonne oder Dunkelheit. Fehlbedienung oder Fehllesen kann Menschen gefährden.
Lesbarkeit und Verlässlichkeit gehen immer vor Optik.

## Tech-Stack (nicht ändern ohne Rückfrage)

- Angular 21.2, nur Standalone Components, keine NgModules
- Build: `@angular/build`, Tests: Vitest
- Offline-Betrieb: `@angular/service-worker` (`ngsw-config.json`)
- Live-Updates: `@microsoft/signalr`
- Daten: rxjs 7.8 und HttpClient
- Export/Import: `jspdf` (PDF), `xlsx` (SheetJS 0.20.3)
- TypeScript 5.9
- Schrift: Manrope, lokal über `@fontsource-variable/manrope`. Keine Google Fonts, keine CDNs.
- **Keine UI-Bibliothek.** Kein Material, PrimeNG, Bootstrap, Tailwind. Alles ist eigenes CSS
  (`styles.css`, `app.css`). Es wird keine Bibliothek eingeführt.
- Hell/Dunkel-Theme wird über `theme.store.ts` gesteuert. Der Mechanismus bleibt, Tokens bauen darauf auf.

## Befehle

- `ng serve`: Dev-Server (Service Worker ist hier normalerweise inaktiv)
- `ng build`: Production-Build (Offline-Tests nur damit, lokal ausgeliefert)
- `ng test`: Vitest
- `ng lint`: nur falls im Projekt eingerichtet

Nach jeder größeren Änderung müssen `ng build` und `ng test` durchlaufen.

## Grundregeln für alle Änderungen

- Fachlogik, Services, Stores, Datenmodell, SignalR-Anbindung, API-Aufrufe und
  Export-Logik (jspdf, xlsx) werden nicht verändert, außer es ist ausdrücklich beauftragt.
  Wenn dafür etwas nötig wäre: erst nachfragen.
- `ngsw-config.json` und das Caching-Verhalten nicht ändern, außer für neue Assets zwingend nötig (vorher nachfragen).
- Bestehende Tests und Selektoren (`data-testid`, von Tests genutzte Klassen) nicht unnötig brechen.
  Wenn doch nötig, Tests mit anpassen.
- Keine neuen Abhängigkeiten ohne Rückfrage.
- Arbeit auf eigenem Branch, kleine Commits, ein Commit pro Etappe oder logischer Einheit.

## Angular-Konventionen

- Standalone Components, `inject()` statt Konstruktor-Injection, wo im Projekt schon so üblich
- `ChangeDetectionStrategy.OnPush` für alle neuen und überarbeiteten Komponenten
- Signals (`signal`, `computed`, `input()`, `output()`) für lokalen UI-Zustand
- Neue Control-Flow-Syntax: `@if`, `@for` (immer mit `track`), `@switch`
- Presentational Components (nur Inputs/Outputs, keine Services) strikt von
  Container-Components trennen
- Kein `any`, strikte Typen beibehalten

## UI-Anforderungen (Einsatztauglichkeit)

- Touch-Ziele mindestens 48 px, wichtige Aktionen deutlich größer (Abstand zwischen Zielen mind. 8 px)
- Status nie nur über Farbe: immer Farbe + Icon + Text
- Statuszustände: unkritisch / Rückzug bald / überfällig / Funkausfall
- Kontrast mindestens WCAG AA, für Timer und Status möglichst AAA
- Lesbar bei direkter Sonne (hell) und nachts (dunkel), beide Themes vollwertig
- Möglichst wenige Klicks, keine Bestätigungsdialoge für Routinevorgänge.
  Bestätigung nur bei schwer umkehrbaren Aktionen (z. B. Trupp beenden, Daten löschen).
- Zeitanzeigen mit `font-variant-numeric: tabular-nums`, damit Ziffern nicht springen
- Ein gemeinsamer Tick (Signal oder Stream) für alle Timer, keine vielen einzelnen `setInterval`
- Verbindungsstatus (SignalR) und Offline-Modus müssen sichtbar sein, damit klar ist, ob die Daten live sind
- Ein Seitenreload darf keinen Zustand verlieren
- Barrierefreiheit: sichtbare Fokuszustände, ARIA-Labels, sinnvolle Tab-Reihenfolge,
  `prefers-reduced-motion` respektieren
- Primäres Zielgerät: Tablet (ca. 1024×768), danach Smartphone (ca. 390×844), dann Desktop

## Styling-Regeln

- Design Tokens als CSS Custom Properties, zentral in `styles.css`, jeweils für Hell und Dunkel.
  Siehe `../docs/design-richtung.md`.
- In Komponenten-Styles keine hartcodierten Farben, Abstände oder Schriftgrößen, nur Tokens.
- Aufteilung: globale Tokens, Reset/Basis und Utilities in `styles.css`.
  Komponentenspezifisches CSS gehört in die jeweilige Komponente.
- Tote CSS-Regeln entfernen, wenn sie sicher unbenutzt sind.

## Arbeitsweise bei größeren Aufgaben

1. Zuerst Codebasis analysieren und kurz zusammenfassen.
2. Plan vorlegen und auf Freigabe warten, bevor Code geändert wird.
3. In Etappen umsetzen und nach jeder Etappe Build und Tests prüfen.
4. Am Ende Übersicht liefern: geänderte Dateien, entfernte Regeln, offene Punkte.
5. UI-Änderungen mit Playwright (falls verfügbar) in Tablet-, Handy-Größe und im Dark Mode per Screenshot prüfen.
