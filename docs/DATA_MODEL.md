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
- startzeit (DateTime)
- warnzeit_min (int)  // z.B. 25
- maxzeit_min (int)   // z.B. 30
- endzeit (DateTime?)
- person1/person2, startdruck_person1/2 // nur noch fuer ein Zuruecksetzen auf aeltere Versionen befuellt

## TruppMitglied (2 bis 4 je Trupp)
- id (Guid)
- trupp_id (Guid)
- person_id (Guid)    // Geraetetraeger
- name (string)       // bei der Anlage festgehalten
- rolle (fuehrer/mitglied)
- reihenfolge (int)   // 0 = Truppfuehrer
- startdruck_bar (int)

## Event (optional)
- id (Guid)
- trupp_id (Guid)
- typ (start, warnung, alarm, beendet)
- zeit (DateTime)
- notiz (string?)

