# ATS Ueberwachung - MVP

Ziel: Eine sehr einfache Webanwendung fuer die Atemschutzueberwachung im Einsatz.
Frontend: Angular, Backend: C# (.NET Web API)

## Annahmen fuer die erste Version
- Einsatzleiter legt einen Einsatz an.
- Trupps werden erfasst (Name/Nummer, 2 Personen).
- Pro Trupp wird die Flasche erfasst (Startdruck, Uhrzeit Start).
- App berechnet verbleibende Einsatzzeit (konfigurierbar).
- Klare Ampel-Logik (Gruen/Gelb/Rot) fuer jeden Trupp.
- Alarm bei Ablauf von Warn- und Max-Zeit.
- Nach Einsatzende werden Zeiten beendet und archiviert.

## Minimaler Workflow
1. Einsatz erstellen (Name, Ort, Alarmzeitpunkt).
2. Trupp anlegen und Startdruck + Startzeit erfassen.
3. Dashboard zeigt Status aller Trupps in Echtzeit.
4. Einsatz beenden und als PDF/CSV exportieren (spaeter).

## Naechste Ausbaustufe (nicht Teil MVP)
- Mehrere Einsaetze parallel.
- Rechte/Rollen.
- Offline-Modus / PWA.
- Schnittstelle zu Funk/Leitstelle.

