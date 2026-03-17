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
{
  "bezeichnung": "Trupp 1",
  "person1": "M. Meyer",
  "person2": "L. Schulz",
  "startdruck_bar": 300,
  "startzeit": "2026-03-17T09:10:00Z",
  "warnzeit_min": 25,
  "maxzeit_min": 30
}

