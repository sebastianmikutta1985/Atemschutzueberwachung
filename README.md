# Atemschutzueberwachung

Webanwendung zur einfachen Atemschutzueberwachung fuer die Feuerwehr.

## Projektstruktur

- `backend/` ASP.NET Core API (C#) mit SQLite
- `frontend/` Angular App
- `docs/` Projekt- und API-Dokumentation

## Lokale Entwicklung

### Backend

```powershell
cd backend
dotnet run
```

### Frontend

```powershell
cd frontend
npm install
npm run start
```

## Hinweise

- Die API laeuft standardmaessig auf `http://localhost:5000`
- Die Angular App erwartet das Backend auf `http://localhost:5000`

