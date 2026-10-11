# API (Entwurf)

Base: /api

## Einsatz
- POST /einsaetze
- GET /einsaetze/aktiv
- POST /einsaetze/{id}/beenden

## Trupps
- POST /einsaetze/{einsatzId}/trupps
- GET /einsaetze/{einsatzId}/trupps
- POST /trupps/{id}/beenden

## Beispiel: Trupp anlegen
POST /api/einsaetze/{einsatzId}/trupps

Zwei bis vier Personen; die erste ist der Truppfuehrer. Startdruck, Warn- und Maxzeit 0 = Voreinstellung der Organisation,
Startzeit leer = Serverzeit.
{
  "truppNameId": "<Id aus /truppnamen>",
  "mitglieder": [
    { "personId": "<Id aus /geraetetraeger>", "startdruckBar": 300 },
    { "personId": "<Id>", "startdruckBar": 0 },
    { "personId": "<Id>", "startdruckBar": 290 }
  ],
  "startzeit": null,
  "warnzeitMin": 25,
  "maxzeitMin": 30
}

Die Trupp-Liste liefert je Trupp `mitglieder` (personId, name, rolle "fuehrer"/"mitglied", startdruckBar,
druckCount, druckMessungen neueste zuerst). Uebergangsweise nimmt der Endpunkt auch noch person1Id/person2Id an und
die Liste enthaelt zusaetzlich die Felder person1*/person2* der ersten beiden Mitglieder (fuer zwischengespeicherte
aeltere App-Versionen; entfaellt im naechsten Release).
