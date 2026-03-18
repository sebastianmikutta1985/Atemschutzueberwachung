using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.WithOrigins("http://localhost:4200")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var dataDir = Path.Combine(builder.Environment.ContentRootPath, "data");
Directory.CreateDirectory(dataDir);
var connectionString = $"Data Source={Path.Combine(dataDir, "ats.db")}";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    await EnsureOrganizationsTable(db);
    await EnsureOrganizationDefaults(db);
    await EnsureUserAccountsTable(db);
    await EnsureSessionsTable(db);
    await EnsureSystemSessionsTable(db);
    await EnsureTruppnamenOrderColumn(db);
    await EnsureTruppDruckColumns(db);
    await EnsureDruckmessungenTable(db);
    await EnsureAlarmEventsTable(db);
    await EnsureOrganizationColumns(db);
    await EnsureDefaultOrganization(db);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

var systemSecret = builder.Configuration["SYSTEM_SECRET"] ?? "changeme";

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }))
    .WithOpenApi();

// Settings (Organization defaults)
app.MapGet("/api/settings", async (HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var org = await db.Organizations.FirstOrDefaultAsync(o => o.Id == auth.OrgId);
    if (org == null)
    {
        return Results.NotFound();
    }
    return Results.Ok(new OrgSettingsDto(
        org.DefaultStartdruckPerson1Bar,
        org.DefaultStartdruckPerson2Bar,
        org.DefaultWarnzeitMin,
        org.DefaultMaxzeitMin
    ));
}).WithOpenApi();

app.MapPut("/api/settings", async (HttpContext http, OrgSettingsUpdate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    if (dto.DefaultStartdruckPerson1Bar <= 0 || dto.DefaultStartdruckPerson2Bar <= 0 || dto.DefaultWarnzeitMin <= 0 || dto.DefaultMaxzeitMin <= 0)
    {
        return Results.BadRequest(new { error = "Werte muessen groesser 0 sein." });
    }
    var org = await db.Organizations.FirstOrDefaultAsync(o => o.Id == auth.OrgId);
    if (org == null)
    {
        return Results.NotFound();
    }
    org.DefaultStartdruckPerson1Bar = dto.DefaultStartdruckPerson1Bar;
    org.DefaultStartdruckPerson2Bar = dto.DefaultStartdruckPerson2Bar;
    org.DefaultWarnzeitMin = dto.DefaultWarnzeitMin;
    org.DefaultMaxzeitMin = dto.DefaultMaxzeitMin;
    await db.SaveChangesAsync();
    return Results.Ok(new OrgSettingsDto(
        org.DefaultStartdruckPerson1Bar,
        org.DefaultStartdruckPerson2Bar,
        org.DefaultWarnzeitMin,
        org.DefaultMaxzeitMin
    ));
}).WithOpenApi();

// Auth
app.MapPost("/api/auth/login", async (LoginRequest dto, AppDbContext db) =>
{
    var code = dto.OrgaCode.Trim().ToUpperInvariant();
    var pin = dto.Pin.Trim();
    if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(pin))
    {
        return Results.BadRequest();
    }

    var org = await db.Organizations.FirstOrDefaultAsync(o => o.Code == code);
    if (org == null || !string.Equals(org.Status, "aktiv", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Unauthorized();
    }

    var accounts = await db.UserAccounts
        .Where(u => u.OrganizationId == org.Id && u.Active)
        .ToListAsync();
    var match = accounts.FirstOrDefault(a => VerifyPin(pin, a.PinHash));
    if (match == null)
    {
        return Results.Unauthorized();
    }

    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    var session = new Session
    {
        Id = Guid.NewGuid(),
        Token = token,
        OrganizationId = org.Id,
        Role = match.Role,
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddHours(12)
    };
    db.Sessions.Add(session);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token,
        role = match.Role,
        orgName = org.Name,
        orgCode = org.Code
    });
}).WithOpenApi();

app.MapGet("/api/auth/me", async (HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    return Results.Ok(new
    {
        role = auth.Role,
        orgName = auth.OrgName,
        orgCode = auth.OrgCode
    });
}).WithOpenApi();

app.MapPost("/api/auth/logout", async (HttpContext http, AppDbContext db) =>
{
    var token = GetBearerToken(http);
    if (string.IsNullOrWhiteSpace(token))
    {
        return Results.Ok();
    }

    var session = await db.Sessions.FirstOrDefaultAsync(s => s.Token == token);
    if (session != null)
    {
        db.Sessions.Remove(session);
        await db.SaveChangesAsync();
    }
    return Results.Ok();
}).WithOpenApi();

// Hersteller-System
app.MapPost("/api/system/login", async (SystemLoginRequest dto, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(dto.Secret) || dto.Secret != systemSecret)
    {
        return Results.Unauthorized();
    }

    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    var session = new SystemSession
    {
        Id = Guid.NewGuid(),
        Token = token,
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddHours(8)
    };
    db.SystemSessions.Add(session);
    await db.SaveChangesAsync();
    return Results.Ok(new { token });
}).WithOpenApi();

app.MapGet("/api/system/orgs", async (HttpContext http, AppDbContext db) =>
{
    if (!await IsSystemAuthorized(http, db))
    {
        return Results.Unauthorized();
    }
    var list = await db.Organizations.OrderBy(o => o.Name).ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

app.MapPost("/api/system/orgs", async (HttpContext http, OrgCreate dto, AppDbContext db) =>
{
    if (!await IsSystemAuthorized(http, db))
    {
        return Results.Unauthorized();
    }
    var name = dto.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest();
    }
    var code = GenerateOrgCode();
    var org = new Organization
    {
        Id = Guid.NewGuid(),
        Name = name,
        Code = code,
        Status = dto.Status ?? "aktiv",
        CreatedAt = DateTime.UtcNow
    };
    db.Organizations.Add(org);
    db.UserAccounts.Add(new UserAccount
    {
        Id = Guid.NewGuid(),
        OrganizationId = org.Id,
        Role = "admin",
        PinHash = HashPin(dto.AdminPin.Trim()),
        Active = true
    });
    db.UserAccounts.Add(new UserAccount
    {
        Id = Guid.NewGuid(),
        OrganizationId = org.Id,
        Role = "user",
        PinHash = HashPin(dto.UserPin.Trim()),
        Active = true
    });
    await db.SaveChangesAsync();
    return Results.Ok(org);
}).WithOpenApi();

app.MapPut("/api/system/orgs/{id:guid}", async (Guid id, HttpContext http, OrgUpdate dto, AppDbContext db) =>
{
    if (!await IsSystemAuthorized(http, db))
    {
        return Results.Unauthorized();
    }
    var org = await db.Organizations.FindAsync(id);
    if (org == null)
    {
        return Results.NotFound();
    }
    if (!string.IsNullOrWhiteSpace(dto.Name))
    {
        org.Name = dto.Name.Trim();
    }
    if (!string.IsNullOrWhiteSpace(dto.Status))
    {
        org.Status = dto.Status.Trim();
    }
    await db.SaveChangesAsync();

    if (!string.IsNullOrWhiteSpace(dto.AdminPin))
    {
        await UpdatePin(db, org.Id, "admin", dto.AdminPin.Trim());
    }
    if (!string.IsNullOrWhiteSpace(dto.UserPin))
    {
        await UpdatePin(db, org.Id, "user", dto.UserPin.Trim());
    }

    return Results.Ok(org);
}).WithOpenApi();

app.MapDelete("/api/system/orgs/{id:guid}", async (Guid id, HttpContext http, AppDbContext db) =>
{
    if (!await IsSystemAuthorized(http, db))
    {
        return Results.Unauthorized();
    }
    var org = await db.Organizations.FindAsync(id);
    if (org == null)
    {
        return Results.NotFound();
    }
    var hasData = await db.Einsaetze.AnyAsync(e => e.OrganizationId == id);
    if (hasData)
    {
        return Results.BadRequest(new { error = "Organisation hat Einsaetze und kann nicht geloescht werden." });
    }
    db.Organizations.Remove(org);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Geraetetraeger
app.MapGet("/api/geraetetraeger", async (HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var list = await db.Geraetetraeger
        .Where(t => t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.Nachname)
        .ThenBy(t => t.Vorname)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

app.MapPost("/api/geraetetraeger", async (HttpContext http, GeraetetraegerCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var entity = new Geraetetraeger
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Vorname = dto.Vorname.Trim(),
        Nachname = dto.Nachname.Trim(),
        Funkrufname = string.IsNullOrWhiteSpace(dto.Funkrufname) ? null : dto.Funkrufname.Trim(),
        Aktiv = dto.Aktiv
    };

    db.Geraetetraeger.Add(entity);
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapPut("/api/geraetetraeger/{id:guid}", async (Guid id, HttpContext http, GeraetetraegerUpdate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var entity = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    entity.Vorname = dto.Vorname.Trim();
    entity.Nachname = dto.Nachname.Trim();
    entity.Funkrufname = string.IsNullOrWhiteSpace(dto.Funkrufname) ? null : dto.Funkrufname.Trim();
    entity.Aktiv = dto.Aktiv;

    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapDelete("/api/geraetetraeger/{id:guid}", async (Guid id, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var entity = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Geraetetraeger.Remove(entity);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Truppnamen (Vorlagen)
app.MapGet("/api/truppnamen", async (HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var list = await db.Truppnamen
        .Where(t => t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.OrderIndex)
        .ThenBy(t => t.Name)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

app.MapPost("/api/truppnamen", async (HttpContext http, TruppNameCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var nextOrder = await db.Truppnamen.Where(t => t.OrganizationId == auth.OrgId).MaxAsync(t => (int?)t.OrderIndex) ?? 0;
    var entity = new TruppName
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Name = dto.Name.Trim(),
        Aktiv = dto.Aktiv,
        OrderIndex = nextOrder + 1
    };

    db.Truppnamen.Add(entity);
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapPut("/api/truppnamen/{id:guid}", async (Guid id, HttpContext http, TruppNameUpdate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var entity = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    entity.Name = dto.Name.Trim();
    entity.Aktiv = dto.Aktiv;
    entity.OrderIndex = dto.OrderIndex;
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapDelete("/api/truppnamen/{id:guid}", async (Guid id, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    var entity = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Truppnamen.Remove(entity);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

app.MapPost("/api/truppnamen/reorder", async (HttpContext http, TruppNameReorder dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    if (!string.Equals(auth.Role, "admin", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Forbid();
    }
    if (dto.Ids == null || dto.Ids.Length == 0)
    {
        return Results.BadRequest();
    }

    var index = 1;
    foreach (var id in dto.Ids)
    {
        var entity = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
        if (entity != null)
        {
            entity.OrderIndex = index;
            index++;
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Einsatz
app.MapPost("/api/einsaetze", async (HttpContext http, EinsatzCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var einsatz = new Einsatz
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Name = dto.Name.Trim(),
        Ort = dto.Ort.Trim(),
        Alarmzeit = dto.Alarmzeit ?? DateTime.Now,
        Status = "aktiv"
    };

    db.Einsaetze.Add(einsatz);
    await db.SaveChangesAsync();
    return Results.Ok(einsatz);
}).WithOpenApi();

app.MapGet("/api/einsaetze/aktiv", async (HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var aktive = await db.Einsaetze
        .Where(e => e.OrganizationId == auth.OrgId && e.Status == "aktiv")
        .OrderByDescending(e => e.Alarmzeit)
        .ToListAsync();
    return Results.Ok(aktive);
}).WithOpenApi();

app.MapGet("/api/einsaetze/letzte", async (HttpContext http, int? limit, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var take = Math.Clamp(limit ?? 10, 1, 50);
    var letzte = await db.Einsaetze
        .Where(e => e.OrganizationId == auth.OrgId)
        .OrderByDescending(e => e.Alarmzeit)
        .Take(take)
        .ToListAsync();
    return Results.Ok(letzte);
}).WithOpenApi();

app.MapPost("/api/einsaetze/{id:guid}/beenden", async (Guid id, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == id && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    einsatz.Status = "beendet";
    einsatz.Endzeit = DateTime.Now;

    var offeneTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id && t.Endzeit == null && t.OrganizationId == auth.OrgId)
        .ToListAsync();

    foreach (var trupp in offeneTrupps)
    {
        trupp.Endzeit = DateTime.Now;
    }

    await db.SaveChangesAsync();
    return Results.Ok(einsatz);
}).WithOpenApi();

app.MapDelete("/api/einsaetze/{id:guid}", async (Guid id, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == id && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    var relatedTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id && t.OrganizationId == auth.OrgId)
        .ToListAsync();

    if (relatedTrupps.Count > 0)
    {
        db.Trupps.RemoveRange(relatedTrupps);
    }

    db.Einsaetze.Remove(einsatz);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Trupps
app.MapPost("/api/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, HttpContext http, TruppCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == einsatzId && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    var person1 = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == dto.Person1Id && t.OrganizationId == auth.OrgId);
    var person2 = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == dto.Person2Id && t.OrganizationId == auth.OrgId);
    var truppName = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == dto.TruppNameId && t.OrganizationId == auth.OrgId);
    var orgDefaults = await db.Organizations.FirstOrDefaultAsync(o => o.Id == auth.OrgId);

    if (person1 == null || person2 == null || truppName == null)
    {
        return Results.BadRequest(new { error = "Trupp und Personen muessen aus der Liste gewaehlt werden." });
    }

    var defP1 = orgDefaults?.DefaultStartdruckPerson1Bar ?? 300;
    var defP2 = orgDefaults?.DefaultStartdruckPerson2Bar ?? 300;
    var defWarn = orgDefaults?.DefaultWarnzeitMin ?? 25;
    var defMax = orgDefaults?.DefaultMaxzeitMin ?? 30;

    var startP1 = dto.StartdruckPerson1Bar > 0 ? dto.StartdruckPerson1Bar : defP1;
    var startP2 = dto.StartdruckPerson2Bar > 0 ? dto.StartdruckPerson2Bar : defP2;
    var warnMin = dto.WarnzeitMin > 0 ? dto.WarnzeitMin : defWarn;
    var maxMin = dto.MaxzeitMin > 0 ? dto.MaxzeitMin : defMax;

    var trupp = new Trupp
    {
        Id = Guid.NewGuid(),
        EinsatzId = einsatzId,
        OrganizationId = auth.OrgId,
        Bezeichnung = truppName.Name,
        Person1Id = person1.Id,
        Person2Id = person2.Id,
        Person1Name = person1.AnzeigeName,
        Person2Name = person2.AnzeigeName,
        StartdruckBar = startP1,
        StartdruckPerson1Bar = startP1,
        StartdruckPerson2Bar = startP2,
        Startzeit = dto.Startzeit ?? DateTime.Now,
        WarnzeitMin = warnMin,
        MaxzeitMin = maxMin
    };

    db.Trupps.Add(trupp);
    await db.SaveChangesAsync();
    return Results.Ok(trupp);
}).WithOpenApi();

app.MapGet("/api/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var trupps = await db.Trupps
        .Where(t => t.EinsatzId == einsatzId && t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.Startzeit)
        .ToListAsync();

    var truppIds = trupps.Select(t => t.Id).ToArray();
    var messungen = await db.Druckmessungen
        .Where(m => m.OrganizationId == auth.OrgId && truppIds.Contains(m.TruppId))
        .OrderByDescending(m => m.Zeit)
        .ToListAsync();

    var counts = messungen
        .GroupBy(m => new { m.TruppId, m.PersonId })
        .Select(g => new { g.Key.TruppId, g.Key.PersonId, Count = g.Count() })
        .ToList();

    var result = trupps.Select(t =>
    {
        var p1 = messungen
            .Where(m => m.TruppId == t.Id && m.PersonId == t.Person1Id)
            .Take(3)
            .Select(m => new DruckInfo(m.DruckBar, m.Zeit))
            .ToArray();
        var p2 = messungen
            .Where(m => m.TruppId == t.Id && m.PersonId == t.Person2Id)
            .Take(3)
            .Select(m => new DruckInfo(m.DruckBar, m.Zeit))
            .ToArray();

        return new TruppDto(
            t.Id,
            t.EinsatzId,
            t.Bezeichnung,
            t.Person1Id,
            t.Person2Id,
            t.Person1Name,
            t.Person2Name,
            t.StartdruckPerson1Bar,
            t.StartdruckPerson2Bar,
            t.Startzeit,
            t.WarnzeitMin,
            t.MaxzeitMin,
            t.Endzeit,
            counts.FirstOrDefault(c => c.TruppId == t.Id && c.PersonId == t.Person1Id)?.Count ?? 0,
            counts.FirstOrDefault(c => c.TruppId == t.Id && c.PersonId == t.Person2Id)?.Count ?? 0,
            p1,
            p2
        );
    }).ToList();

    return Results.Ok(result);
}).WithOpenApi();

app.MapPost("/api/trupps/{id:guid}/beenden", async (Guid id, HttpContext http, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    trupp.Endzeit = DateTime.Now;
    await db.SaveChangesAsync();
    return Results.Ok(trupp);
}).WithOpenApi();

app.MapPost("/api/trupps/{id:guid}/druckmessungen", async (Guid id, HttpContext http, DruckmessungCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    if (trupp.Endzeit != null)
    {
        return Results.BadRequest(new { error = "Trupp ist bereits beendet." });
    }

    if (dto.PersonId != trupp.Person1Id && dto.PersonId != trupp.Person2Id)
    {
        return Results.BadRequest(new { error = "Person gehoert nicht zu diesem Trupp." });
    }

    var count = await db.Druckmessungen.CountAsync(m => m.OrganizationId == auth.OrgId && m.TruppId == id && m.PersonId == dto.PersonId);
    if (count >= 3)
    {
        return Results.BadRequest(new { error = "Maximal 3 Druckmessungen pro Person." });
    }

    var messung = new Druckmessung
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        TruppId = id,
        PersonId = dto.PersonId,
        DruckBar = dto.DruckBar,
        Zeit = DateTime.Now
    };

    db.Druckmessungen.Add(messung);
    await db.SaveChangesAsync();
    return Results.Ok(messung);
}).WithOpenApi();

app.MapPost("/api/trupps/{id:guid}/events", async (Guid id, HttpContext http, AlarmEventCreate dto, AppDbContext db) =>
{
    var auth = await GetAuthAsync(http, db);
    if (auth == null)
    {
        return Results.Unauthorized();
    }
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    var type = dto.Typ.Trim().ToLowerInvariant();
    if (type != "warn" && type != "max")
    {
        return Results.BadRequest(new { error = "Unbekannter Event-Typ." });
    }

    var ev = new AlarmEvent
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        TruppId = id,
        Typ = type,
        Zeit = DateTime.Now,
        Nachricht = dto.Nachricht?.Trim()
    };

    db.AlarmEvents.Add(ev);
    await db.SaveChangesAsync();
    return Results.Ok(ev);
}).WithOpenApi();

app.Run();

static async Task EnsureTruppnamenOrderColumn(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name='Truppnamen';";
    var tableExists = await cmd.ExecuteScalarAsync();
    if (tableExists == null)
    {
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS Truppnamen (
            Id TEXT NOT NULL PRIMARY KEY,
            OrganizationId TEXT NOT NULL,
            Name TEXT NOT NULL,
            Aktiv INTEGER NOT NULL,
            OrderIndex INTEGER NOT NULL DEFAULT 0
        );
        """;
        await cmd.ExecuteNonQueryAsync();
        return;
    }

    cmd.CommandText = "PRAGMA table_info(Truppnamen);";
    await using var reader = await cmd.ExecuteReaderAsync();
    var hasOrder = false;
    while (await reader.ReadAsync())
    {
        var name = reader.GetString(1);
        if (string.Equals(name, "OrderIndex", StringComparison.OrdinalIgnoreCase))
        {
            hasOrder = true;
            break;
        }
    }

    if (!hasOrder)
    {
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Truppnamen ADD COLUMN OrderIndex INTEGER NOT NULL DEFAULT 0;");
        await db.Database.ExecuteSqlRawAsync("UPDATE Truppnamen SET OrderIndex = rowid WHERE OrderIndex = 0;");
    }
}

static async Task EnsureTruppDruckColumns(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = "PRAGMA table_info(Trupps);";
    await using var reader = await cmd.ExecuteReaderAsync();
    var hasP1 = false;
    var hasP2 = false;
    while (await reader.ReadAsync())
    {
        var name = reader.GetString(1);
        if (string.Equals(name, "StartdruckPerson1Bar", StringComparison.OrdinalIgnoreCase)) hasP1 = true;
        if (string.Equals(name, "StartdruckPerson2Bar", StringComparison.OrdinalIgnoreCase)) hasP2 = true;
    }

    if (!hasP1)
    {
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Trupps ADD COLUMN StartdruckPerson1Bar INTEGER NOT NULL DEFAULT 300;");
        await db.Database.ExecuteSqlRawAsync("UPDATE Trupps SET StartdruckPerson1Bar = StartdruckBar WHERE StartdruckPerson1Bar = 300;");
    }
    if (!hasP2)
    {
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Trupps ADD COLUMN StartdruckPerson2Bar INTEGER NOT NULL DEFAULT 300;");
        await db.Database.ExecuteSqlRawAsync("UPDATE Trupps SET StartdruckPerson2Bar = StartdruckBar WHERE StartdruckPerson2Bar = 300;");
    }
}

static async Task EnsureOrganizationsTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS Organizations (
            Id TEXT NOT NULL PRIMARY KEY,
            Name TEXT NOT NULL,
            Code TEXT NOT NULL UNIQUE,
            Status TEXT NOT NULL,
            CreatedAt TEXT NOT NULL,
            DefaultStartdruckPerson1Bar INTEGER NOT NULL DEFAULT 300,
            DefaultStartdruckPerson2Bar INTEGER NOT NULL DEFAULT 300,
            DefaultWarnzeitMin INTEGER NOT NULL DEFAULT 25,
            DefaultMaxzeitMin INTEGER NOT NULL DEFAULT 30
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureOrganizationDefaults(AppDbContext db)
{
    var defaults = new[]
    {
        ("DefaultStartdruckPerson1Bar", "INTEGER NOT NULL DEFAULT 300"),
        ("DefaultStartdruckPerson2Bar", "INTEGER NOT NULL DEFAULT 300"),
        ("DefaultWarnzeitMin", "INTEGER NOT NULL DEFAULT 25"),
        ("DefaultMaxzeitMin", "INTEGER NOT NULL DEFAULT 30")
    };

    foreach (var (name, ddl) in defaults)
    {
        var has = await HasColumn(db, "Organizations", name);
        if (!has)
        {
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE Organizations ADD COLUMN {name} {ddl};");
        }
    }
}

static async Task EnsureUserAccountsTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS UserAccounts (
            Id TEXT NOT NULL PRIMARY KEY,
            OrganizationId TEXT NOT NULL,
            Role TEXT NOT NULL,
            PinHash TEXT NOT NULL,
            Active INTEGER NOT NULL
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureSessionsTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS Sessions (
            Id TEXT NOT NULL PRIMARY KEY,
            Token TEXT NOT NULL,
            OrganizationId TEXT NOT NULL,
            Role TEXT NOT NULL,
            CreatedAt TEXT NOT NULL,
            ExpiresAt TEXT NOT NULL
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureSystemSessionsTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS SystemSessions (
            Id TEXT NOT NULL PRIMARY KEY,
            Token TEXT NOT NULL,
            CreatedAt TEXT NOT NULL,
            ExpiresAt TEXT NOT NULL
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureOrganizationColumns(AppDbContext db)
{
    var tables = new[] { "Einsaetze", "Trupps", "Geraetetraeger", "Truppnamen", "Druckmessungen", "AlarmEvents" };
    foreach (var table in tables)
    {
        var hasColumn = await HasColumn(db, table, "OrganizationId");
        if (!hasColumn)
        {
            await db.Database.ExecuteSqlRawAsync(
                $"ALTER TABLE {table} ADD COLUMN OrganizationId TEXT NOT NULL DEFAULT '';"
            );
        }
    }
}

static async Task<bool> HasColumn(AppDbContext db, string tableName, string columnName)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = $"PRAGMA table_info({tableName});";
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var name = reader.GetString(1);
        if (string.Equals(name, columnName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
    }
    return false;
}

static async Task EnsureDefaultOrganization(AppDbContext db)
{
    var org = await db.Organizations.FirstOrDefaultAsync();
    if (org == null)
    {
        var code = GenerateOrgCode();
        org = new Organization
        {
            Id = Guid.NewGuid(),
            Name = "Demo Feuerwehr",
            Code = code,
            Status = "aktiv",
            CreatedAt = DateTime.UtcNow
        };
        db.Organizations.Add(org);
        await db.SaveChangesAsync();

        Console.WriteLine($"[BOOTSTRAP] Default organization created. Code: {code}");
    }

    var orgId = org.Id.ToString();
    await db.Database.ExecuteSqlRawAsync("UPDATE Einsaetze SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);
    await db.Database.ExecuteSqlRawAsync("UPDATE Trupps SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);
    await db.Database.ExecuteSqlRawAsync("UPDATE Geraetetraeger SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);
    await db.Database.ExecuteSqlRawAsync("UPDATE Truppnamen SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);
    await db.Database.ExecuteSqlRawAsync("UPDATE Druckmessungen SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);
    await db.Database.ExecuteSqlRawAsync("UPDATE AlarmEvents SET OrganizationId = {0} WHERE OrganizationId = '';", orgId);

    var hasAdmin = await db.UserAccounts.AnyAsync(u => u.OrganizationId == org.Id && u.Role == "admin");
    if (!hasAdmin)
    {
        var adminPin = "1234";
        var userPin = "0000";
        db.UserAccounts.Add(new UserAccount
        {
            Id = Guid.NewGuid(),
            OrganizationId = org.Id,
            Role = "admin",
            PinHash = HashPin(adminPin),
            Active = true
        });
        db.UserAccounts.Add(new UserAccount
        {
            Id = Guid.NewGuid(),
            OrganizationId = org.Id,
            Role = "user",
            PinHash = HashPin(userPin),
            Active = true
        });
        await db.SaveChangesAsync();
        Console.WriteLine($"[BOOTSTRAP] Default pins set. Admin: {adminPin}, User: {userPin}");
    }
}

static string GenerateOrgCode()
{
    const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var bytes = RandomNumberGenerator.GetBytes(6);
    var sb = new StringBuilder();
    foreach (var b in bytes)
    {
        sb.Append(chars[b % chars.Length]);
    }
    return sb.ToString();
}

static string HashPin(string pin)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    using var pbkdf2 = new Rfc2898DeriveBytes(pin, salt, 100_000, HashAlgorithmName.SHA256);
    var hash = pbkdf2.GetBytes(32);
    return $"{Convert.ToHexString(salt)}:{Convert.ToHexString(hash)}";
}

static bool VerifyPin(string pin, string hash)
{
    var parts = hash.Split(':');
    if (parts.Length != 2)
    {
        return false;
    }
    var salt = Convert.FromHexString(parts[0]);
    var expected = Convert.FromHexString(parts[1]);
    using var pbkdf2 = new Rfc2898DeriveBytes(pin, salt, 100_000, HashAlgorithmName.SHA256);
    var actual = pbkdf2.GetBytes(32);
    return CryptographicOperations.FixedTimeEquals(actual, expected);
}

static string? GetBearerToken(HttpContext http)
{
    var auth = http.Request.Headers.Authorization.ToString();
    if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        return auth.Substring("Bearer ".Length).Trim();
    }
    return null;
}

static async Task<AuthContext?> GetAuthAsync(HttpContext http, AppDbContext db)
{
    var token = GetBearerToken(http);
    if (string.IsNullOrWhiteSpace(token))
    {
        return null;
    }

    var session = await db.Sessions.FirstOrDefaultAsync(s => s.Token == token);
    if (session == null || session.ExpiresAt <= DateTime.UtcNow)
    {
        return null;
    }

    var org = await db.Organizations.FindAsync(session.OrganizationId);
    if (org == null || !string.Equals(org.Status, "aktiv", StringComparison.OrdinalIgnoreCase))
    {
        return null;
    }

    return new AuthContext(org.Id, session.Role, org.Name, org.Code);
}

static async Task<bool> IsSystemAuthorized(HttpContext http, AppDbContext db)
{
    var auth = http.Request.Headers.Authorization.ToString();
    if (!auth.StartsWith("System ", StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }
    var token = auth.Substring("System ".Length).Trim();
    if (string.IsNullOrWhiteSpace(token))
    {
        return false;
    }
    var session = await db.SystemSessions.FirstOrDefaultAsync(s => s.Token == token);
    if (session == null || session.ExpiresAt <= DateTime.UtcNow)
    {
        return false;
    }
    return true;
}

static async Task UpdatePin(AppDbContext db, Guid orgId, string role, string pin)
{
    var account = await db.UserAccounts.FirstOrDefaultAsync(u => u.OrganizationId == orgId && u.Role == role);
    if (account == null)
    {
        account = new UserAccount
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Role = role,
            Active = true
        };
        db.UserAccounts.Add(account);
    }
    account.PinHash = HashPin(pin);
    await db.SaveChangesAsync();
}

static async Task EnsureDruckmessungenTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name='Druckmessungen';";
    var tableExists = await cmd.ExecuteScalarAsync();
    if (tableExists != null)
    {
        return;
    }

    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS Druckmessungen (
            Id TEXT NOT NULL PRIMARY KEY,
            OrganizationId TEXT NOT NULL,
            TruppId TEXT NOT NULL,
            PersonId TEXT NOT NULL,
            DruckBar INTEGER NOT NULL,
            Zeit TEXT NOT NULL
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task EnsureAlarmEventsTable(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using var cmd = connection.CreateCommand();
    cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name='AlarmEvents';";
    var tableExists = await cmd.ExecuteScalarAsync();
    if (tableExists != null)
    {
        return;
    }

    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS AlarmEvents (
            Id TEXT NOT NULL PRIMARY KEY,
            OrganizationId TEXT NOT NULL,
            TruppId TEXT NOT NULL,
            Typ TEXT NOT NULL,
            Zeit TEXT NOT NULL,
            Nachricht TEXT NULL
        );
        """;
    await cmd.ExecuteNonQueryAsync();
}

class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Einsatz> Einsaetze => Set<Einsatz>();
    public DbSet<Trupp> Trupps => Set<Trupp>();
    public DbSet<Geraetetraeger> Geraetetraeger => Set<Geraetetraeger>();
    public DbSet<TruppName> Truppnamen => Set<TruppName>();
    public DbSet<Druckmessung> Druckmessungen => Set<Druckmessung>();
    public DbSet<AlarmEvent> AlarmEvents => Set<AlarmEvent>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<SystemSession> SystemSessions => Set<SystemSession>();
}

class Einsatz
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Ort { get; set; } = string.Empty;
    public DateTime Alarmzeit { get; set; }
    public string Status { get; set; } = "aktiv";
    public DateTime? Endzeit { get; set; }
}

class Trupp
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid EinsatzId { get; set; }
    public string Bezeichnung { get; set; } = string.Empty;
    public Guid Person1Id { get; set; }
    public Guid Person2Id { get; set; }
    public string Person1Name { get; set; } = string.Empty;
    public string Person2Name { get; set; } = string.Empty;
    public int StartdruckBar { get; set; }
    public int StartdruckPerson1Bar { get; set; }
    public int StartdruckPerson2Bar { get; set; }
    public DateTime Startzeit { get; set; }
    public int WarnzeitMin { get; set; }
    public int MaxzeitMin { get; set; }
    public DateTime? Endzeit { get; set; }
}

class Geraetetraeger
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Vorname { get; set; } = string.Empty;
    public string Nachname { get; set; } = string.Empty;
    public string? Funkrufname { get; set; }
    public bool Aktiv { get; set; } = true;

    public string AnzeigeName => string.IsNullOrWhiteSpace(Funkrufname)
        ? $"{Nachname} {Vorname}".Trim()
        : Funkrufname!;
}

class TruppName
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool Aktiv { get; set; } = true;
    public int OrderIndex { get; set; }
}

class Druckmessung
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid TruppId { get; set; }
    public Guid PersonId { get; set; }
    public int DruckBar { get; set; }
    public DateTime Zeit { get; set; }
}

class AlarmEvent
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid TruppId { get; set; }
    public string Typ { get; set; } = string.Empty;
    public DateTime Zeit { get; set; }
    public string? Nachricht { get; set; }
}

class Organization
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Status { get; set; } = "aktiv";
    public DateTime CreatedAt { get; set; }
    public int DefaultStartdruckPerson1Bar { get; set; } = 300;
    public int DefaultStartdruckPerson2Bar { get; set; } = 300;
    public int DefaultWarnzeitMin { get; set; } = 25;
    public int DefaultMaxzeitMin { get; set; } = 30;
}

class UserAccount
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Role { get; set; } = "user";
    public string PinHash { get; set; } = string.Empty;
    public bool Active { get; set; } = true;
}

class Session
{
    public Guid Id { get; set; }
    public string Token { get; set; } = string.Empty;
    public Guid OrganizationId { get; set; }
    public string Role { get; set; } = "user";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

class SystemSession
{
    public Guid Id { get; set; }
    public string Token { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

record EinsatzCreate(string Name, string Ort, DateTime? Alarmzeit);
record TruppCreate(
    Guid TruppNameId,
    Guid Person1Id,
    Guid Person2Id,
    int StartdruckPerson1Bar,
    int StartdruckPerson2Bar,
    DateTime? Startzeit,
    int WarnzeitMin,
    int MaxzeitMin
);
record GeraetetraegerCreate(string Vorname, string Nachname, string? Funkrufname, bool Aktiv);
record GeraetetraegerUpdate(string Vorname, string Nachname, string? Funkrufname, bool Aktiv);
record TruppNameCreate(string Name, bool Aktiv);
record TruppNameUpdate(string Name, bool Aktiv, int OrderIndex);
record TruppNameReorder(Guid[] Ids);
record DruckmessungCreate(Guid PersonId, int DruckBar);
record AlarmEventCreate(string Typ, string? Nachricht);
record LoginRequest(string OrgaCode, string Pin);
record SystemLoginRequest(string Secret);
record OrgSettingsDto(int DefaultStartdruckPerson1Bar, int DefaultStartdruckPerson2Bar, int DefaultWarnzeitMin, int DefaultMaxzeitMin);
record OrgSettingsUpdate(int DefaultStartdruckPerson1Bar, int DefaultStartdruckPerson2Bar, int DefaultWarnzeitMin, int DefaultMaxzeitMin);
record OrgCreate(string Name, string AdminPin, string UserPin, string? Status);
record OrgUpdate(string? Name, string? AdminPin, string? UserPin, string? Status);
record AuthContext(Guid OrgId, string Role, string OrgName, string OrgCode);

record TruppDto(
    Guid Id,
    Guid EinsatzId,
    string Bezeichnung,
    Guid Person1Id,
    Guid Person2Id,
    string Person1Name,
    string Person2Name,
    int StartdruckPerson1Bar,
    int StartdruckPerson2Bar,
    DateTime Startzeit,
    int WarnzeitMin,
    int MaxzeitMin,
    DateTime? Endzeit,
    int DruckCountPerson1,
    int DruckCountPerson2,
    DruckInfo[] DruckMessungenPerson1,
    DruckInfo[] DruckMessungenPerson2
);

record DruckInfo(int DruckBar, DateTime Zeit);
