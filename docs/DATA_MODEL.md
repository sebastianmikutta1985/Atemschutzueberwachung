# Datenmodell (Entwurf)

## Einsatz
- id (Guid)
- name (string)
- ort (string)
- alarmzeit (DateTime)
- status (aktiv/beendet)

## Trupp
- id (Guid)
- einsatz_id (Guid)
- bezeichnung (string)
- person1 (string)
- person2 (string)
- startdruck_bar (int)
- startzeit (DateTime)
- warnzeit_min (int)  // z.B. 25
- maxzeit_min (int)   // z.B. 30
- endzeit (DateTime?)

## Event (optional)
- id (Guid)
- trupp_id (Guid)
- typ (start, warnung, alarm, beendet)
- zeit (DateTime)
- notiz (string?)

