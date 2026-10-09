# Design-Richtung: Atemschutzüberwachung

Ablage im Projekt: `docs/design-richtung.md`. Alle Werte sind ein Startvorschlag.
Kontraste vor der Übernahme mit einem Checker prüfen (z. B. WebAIM) und am echten Tablet in Sonne und Dunkelheit testen.

## Leitidee

Ruhige, neutrale Oberfläche. Farbe ist ausschließlich Signal und gehört dem Status.
Die wichtigsten Informationen (Restzeit, Druck, Status) sind riesig und stehen an immer derselben Stelle.
Alles andere tritt zurück. Kein Schmuck, keine Verläufe, keine Animationen außer bei Warnungen.

## Themes

- **Dunkel** ist die Standardannahme für den Einsatz (Nacht, Blendung vermeiden).
- **Hell** ist voll gleichwertig und muss bei direkter Sonne funktionieren (höchster Kontrast, keine hellgrauen Texte).
- Umschaltung weiter über `theme.store.ts`. Die Tokens hängen an dem Selektor, den der Store aktuell setzt.

## Statusmodell

Jeder Status hat Farbe, Icon und Text. Nie nur Farbe.

| Status | Text | Icon-Idee | Verhalten |
|---|---|---|---|
| Unkritisch | OK | Haken | ruhig |
| Rückzug bald | RÜCKZUG | Warndreieck | auffällig, optional Signalton |
| Überfällig | ÜBERFÄLLIG | Ausrufezeichen im Kreis | maximal auffällig, pulsierender Rand (nicht bei reduced-motion), Signalton |
| Funkausfall | KEIN FUNK | durchgestrichene Funkwellen | eigene Farbe, klar von Zeitstatus unterscheidbar |

Farbwelt: Grün, Amber, Rot, Violett. Violett für Funkausfall, damit es sich nicht mit den
Zeitstufen vermischt und auch bei Rot-Grün-Schwäche unterscheidbar bleibt.

## Token-Vorschlag

```css
:root {
  /* Typografie */
  --font-sans: "Manrope Variable", system-ui, sans-serif;
  --fs-xs: 0.8125rem;
  --fs-sm: 0.9375rem;
  --fs-base: 1.0625rem;   /* Basis bewusst größer als üblich */
  --fs-lg: 1.25rem;
  --fs-xl: 1.5rem;
  --fs-2xl: 2rem;
  --fs-timer: clamp(2.5rem, 6vw, 4.5rem);
  --fw-regular: 500;
  --fw-bold: 700;
  --fw-heavy: 800;

  /* Abstände (4px-Raster) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* Bedienung */
  --touch-min: 3rem;       /* 48px */
  --touch-primary: 4rem;   /* 64px für Hauptaktionen */
  --touch-gap: 0.5rem;

  /* Form */
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --border-w: 2px;
  --focus-ring: 3px;

  /* Ebenen */
  --z-header: 100;
  --z-dialog: 200;
  --z-toast: 300;
}

/* Hell */
:root {
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --text: #0f172a;
  --text-muted: #475569;
  --border: #cbd5e1;
  --primary: #1d4ed8;
  --primary-contrast: #ffffff;
  --focus: #1d4ed8;

  --status-ok-solid: #15803d;   --status-ok-bg: #dcfce7;   --status-ok-fg: #14532d;
  --status-warn-solid: #b45309; --status-warn-bg: #fef3c7; --status-warn-fg: #78350f;
  --status-crit-solid: #b91c1c; --status-crit-bg: #fee2e2; --status-crit-fg: #7f1d1d;
  --status-radio-solid: #6d28d9; --status-radio-bg: #ede9fe; --status-radio-fg: #4c1d95;
}

/* Dunkel (Selektor an theme.store.ts anpassen) */
[data-theme="dark"] {
  --bg: #0b0f14;
  --surface: #151b23;
  --surface-raised: #1e2630;
  --text: #f1f5f9;
  --text-muted: #a8b3c2;
  --border: #334155;
  --primary: #60a5fa;
  --primary-contrast: #0b0f14;
  --focus: #93c5fd;

  --status-ok-solid: #22c55e;   --status-ok-bg: #052e16;   --status-ok-fg: #86efac;
  --status-warn-solid: #f59e0b; --status-warn-bg: #422006; --status-warn-fg: #fcd34d;
  --status-crit-solid: #ef4444; --status-crit-bg: #450a0a; --status-crit-fg: #fca5a5;
  --status-radio-solid: #8b5cf6; --status-radio-bg: #2e1065; --status-radio-fg: #c4b5fd;
}
```

## Trupp-Karte (Hauptkomponente)

Aufbau von oben nach unten, immer gleich:

1. Kopfzeile: Truppname/Nummer links, Statusbadge (Icon + Text) rechts
2. Restzeit riesig (`--fs-timer`, `tabular-nums`, Gewicht 800) als dominantes Element
3. Druck der Truppmitglieder gut lesbar, mit Balken zusätzlich zur Zahl
4. Einsatzauftrag und Startzeit klein, `--text-muted`
5. Aktionsleiste unten: Druckabfrage / Rückmeldung als große Buttons (`--touch-primary`)

Der gesamte Kartenrahmen und der Statusstreifen nehmen die Statusfarbe an (Rand in
`--border-w`, nicht nur ein kleiner Punkt). Bei Überfällig und Funkausfall ist die Karte
auch aus drei Metern Entfernung sofort als Problemfall erkennbar.

## Layout

- **Tablet (primär):** Raster mit 2 bis 3 Spalten, alle Trupps auf einen Blick, kein Scrollen bei bis zu ca. 6 Trupps
- **Smartphone:** eine Spalte, Karten kompakter, aber gleiche Reihenfolge der Inhalte
- **Desktop:** gleiches Raster, mehr Spalten, kein eigenes Layout
- Kopfleiste fix mit Verbindungsstatus (live / verbindet / offline), Uhrzeit, Theme-Schalter und der Aktion "Trupp anlegen"
- Sortierung der Karten: kritischster Status zuerst, innerhalb davon nach geringster Restzeit

## Interaktion und Bewegung

- Kein Hover-Zustand als einziger Hinweis (Touch). Aktiv-/Gedrückt-Zustand deutlich.
- Fokusring immer sichtbar: `outline: var(--focus-ring) solid var(--focus)` mit Offset
- Animation nur für Warnzustände (Puls am Rand), mit `@media (prefers-reduced-motion: reduce)` abschaltbar
- Warnungen zusätzlich akustisch, aber nie als einziges Signal
- Bestätigungsdialog nur bei schwer umkehrbaren Aktionen, mit großen Buttons und klar benannter Aktion ("Trupp beenden", nicht "OK")

## Offene Punkte zum Prüfen

- Unterstützt Manrope Variable `tnum` (tabellarische Ziffern) sauber? Sonst für Timer auf eine Fallback-Schrift mit festen Ziffern wechseln oder die Ziffern einzeln in Boxen setzen.
- Welches Icon-Set? Ohne Bibliothek bieten sich eigene Inline-SVGs an, als einzelne Komponente gekapselt.
- Wo liegt die Grenze für "Rückzug bald" (Restzeit-Schwelle)? Das ist Fachlogik und bleibt wie im bestehenden Code.
- Signaltöne: Gibt es dafür schon eine Lösung im Projekt? Falls nein, als eigener, separater Schritt behandeln.

## Umsetzung (Stand Redesign-Etappe a)

Die Tokens stehen in `frontend/src/styles.css`. Gegenüber dem Vorschlag oben nach Kontrastprüfung ergänzt:

| Token | Grund |
|---|---|
| `--border-strong` (hell `#64748b`, dunkel `#7b8794`) | `--border` erreicht nur 1,5:1 bzw. 1,7:1. Rahmen von Eingabefeldern und Buttons brauchen mind. 3:1 (WCAG 1.4.11). `--border` bleibt für Trennlinien. |
| `--status-*-on` | Text auf vollflächiger Statusfarbe: hell weiß (5,0–7,1:1), dunkel `#0b0f14` (4,5–9,0:1). Weiß auf den dunklen Statusfarben läge bei 2,2–4,2:1. |
| `--status-neutral-*` | Beendete Trupps (grau), klar getrennt von den vier Statusfarben. |
| `--status-crit-strong` | Dunkleres Rot für Mayday-Banner und Puls. |
| `--surface-sunken`, `--backdrop`, `--backdrop-alarm` | Deaktivierte Felder, Dialog-Hintergrund, Mayday-Vollbild. |
| `--shadow-1/2`, `--dur-*`, `--z-banner`, `--z-alarm` | Schatten, Bewegung, Alarm über Dialogen. |

Farbiger Text auf Flächen verwendet die `-fg`-Töne (mind. 8:1), nicht `-solid` (dunkles Violett nur 4,1:1).

Statusanzeige (nur Darstellung, Fachlogik unverändert):

| Anzeige | Bedingung im Code |
|---|---|
| MAYDAY | `maydayAktiv` |
| ÜBERFÄLLIG | `statusFor() === 'rot'` (Maximalzeit erreicht) |
| RÜCKZUG | `statusFor() === 'gelb'` oder Rückzugsdruck erreicht/prognostiziert |
| OK | sonst |
| BEENDET | Trupp zurück |

Funkausfall ist vorbereitet (Tokens), wird aber erst angezeigt, wenn es dafür Daten gibt. Die Reihenfolge der Trupps bleibt nach Startzeit, damit Karten nicht unter dem Finger springen.
