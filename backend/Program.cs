using Microsoft.EntityFrameworkCore;

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
    await EnsureTruppnamenOrderColumn(db);
    await EnsureTruppDruckColumns(db);
    await EnsureDruckmessungenTable(db);
    await EnsureAlarmEventsTable(db);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }))
    .WithOpenApi();

// Geraetetraeger
app.MapGet("/api/geraetetraeger", async (AppDbContext db) =>
{
    var list = await db.Geraetetraeger
        .OrderBy(t => t.Nachname)
        .ThenBy(t => t.Vorname)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

app.MapPost("/api/geraetetraeger", async (GeraetetraegerCreate dto, AppDbContext db) =>
{
    var entity = new Geraetetraeger
    {
        Id = Guid.NewGuid(),
        Vorname = dto.Vorname.Trim(),
        Nachname = dto.Nachname.Trim(),
        Funkrufname = string.IsNullOrWhiteSpace(dto.Funkrufname) ? null : dto.Funkrufname.Trim(),
        Aktiv = dto.Aktiv
    };

    db.Geraetetraeger.Add(entity);
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapPut("/api/geraetetraeger/{id:guid}", async (Guid id, GeraetetraegerUpdate dto, AppDbContext db) =>
{
    var entity = await db.Geraetetraeger.FindAsync(id);
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

app.MapDelete("/api/geraetetraeger/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var entity = await db.Geraetetraeger.FindAsync(id);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Geraetetraeger.Remove(entity);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Truppnamen (Vorlagen)
app.MapGet("/api/truppnamen", async (AppDbContext db) =>
{
    var list = await db.Truppnamen
        .OrderBy(t => t.OrderIndex)
        .ThenBy(t => t.Name)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

app.MapPost("/api/truppnamen", async (TruppNameCreate dto, AppDbContext db) =>
{
    var nextOrder = await db.Truppnamen.MaxAsync(t => (int?)t.OrderIndex) ?? 0;
    var entity = new TruppName
    {
        Id = Guid.NewGuid(),
        Name = dto.Name.Trim(),
        Aktiv = dto.Aktiv,
        OrderIndex = nextOrder + 1
    };

    db.Truppnamen.Add(entity);
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).WithOpenApi();

app.MapPut("/api/truppnamen/{id:guid}", async (Guid id, TruppNameUpdate dto, AppDbContext db) =>
{
    var entity = await db.Truppnamen.FindAsync(id);
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

app.MapDelete("/api/truppnamen/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var entity = await db.Truppnamen.FindAsync(id);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Truppnamen.Remove(entity);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

app.MapPost("/api/truppnamen/reorder", async (TruppNameReorder dto, AppDbContext db) =>
{
    if (dto.Ids == null || dto.Ids.Length == 0)
    {
        return Results.BadRequest();
    }

    var index = 1;
    foreach (var id in dto.Ids)
    {
        var entity = await db.Truppnamen.FindAsync(id);
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
app.MapPost("/api/einsaetze", async (EinsatzCreate dto, AppDbContext db) =>
{
    var einsatz = new Einsatz
    {
        Id = Guid.NewGuid(),
        Name = dto.Name.Trim(),
        Ort = dto.Ort.Trim(),
        Alarmzeit = dto.Alarmzeit ?? DateTime.Now,
        Status = "aktiv"
    };

    db.Einsaetze.Add(einsatz);
    await db.SaveChangesAsync();
    return Results.Ok(einsatz);
}).WithOpenApi();

app.MapGet("/api/einsaetze/aktiv", async (AppDbContext db) =>
{
    var aktive = await db.Einsaetze
        .Where(e => e.Status == "aktiv")
        .OrderByDescending(e => e.Alarmzeit)
        .ToListAsync();
    return Results.Ok(aktive);
}).WithOpenApi();

app.MapGet("/api/einsaetze/letzte", async (int? limit, AppDbContext db) =>
{
    var take = Math.Clamp(limit ?? 10, 1, 50);
    var letzte = await db.Einsaetze
        .OrderByDescending(e => e.Alarmzeit)
        .Take(take)
        .ToListAsync();
    return Results.Ok(letzte);
}).WithOpenApi();

app.MapPost("/api/einsaetze/{id:guid}/beenden", async (Guid id, AppDbContext db) =>
{
    var einsatz = await db.Einsaetze.FindAsync(id);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    einsatz.Status = "beendet";
    einsatz.Endzeit = DateTime.Now;

    var offeneTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id && t.Endzeit == null)
        .ToListAsync();

    foreach (var trupp in offeneTrupps)
    {
        trupp.Endzeit = DateTime.Now;
    }

    await db.SaveChangesAsync();
    return Results.Ok(einsatz);
}).WithOpenApi();

app.MapDelete("/api/einsaetze/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var einsatz = await db.Einsaetze.FindAsync(id);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    var relatedTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id)
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
app.MapPost("/api/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, TruppCreate dto, AppDbContext db) =>
{
    var einsatz = await db.Einsaetze.FindAsync(einsatzId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    var person1 = await db.Geraetetraeger.FindAsync(dto.Person1Id);
    var person2 = await db.Geraetetraeger.FindAsync(dto.Person2Id);
    var truppName = await db.Truppnamen.FindAsync(dto.TruppNameId);

    if (person1 == null || person2 == null || truppName == null)
    {
        return Results.BadRequest(new { error = "Trupp und Personen muessen aus der Liste gewaehlt werden." });
    }

    var trupp = new Trupp
    {
        Id = Guid.NewGuid(),
        EinsatzId = einsatzId,
        Bezeichnung = truppName.Name,
        Person1Id = person1.Id,
        Person2Id = person2.Id,
        Person1Name = person1.AnzeigeName,
        Person2Name = person2.AnzeigeName,
        StartdruckBar = dto.StartdruckPerson1Bar,
        StartdruckPerson1Bar = dto.StartdruckPerson1Bar,
        StartdruckPerson2Bar = dto.StartdruckPerson2Bar,
        Startzeit = dto.Startzeit ?? DateTime.Now,
        WarnzeitMin = dto.WarnzeitMin,
        MaxzeitMin = dto.MaxzeitMin
    };

    db.Trupps.Add(trupp);
    await db.SaveChangesAsync();
    return Results.Ok(trupp);
}).WithOpenApi();

app.MapGet("/api/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, AppDbContext db) =>
{
    var trupps = await db.Trupps
        .Where(t => t.EinsatzId == einsatzId)
        .OrderBy(t => t.Startzeit)
        .ToListAsync();

    var truppIds = trupps.Select(t => t.Id).ToArray();
    var messungen = await db.Druckmessungen
        .Where(m => truppIds.Contains(m.TruppId))
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

app.MapPost("/api/trupps/{id:guid}/beenden", async (Guid id, AppDbContext db) =>
{
    var trupp = await db.Trupps.FindAsync(id);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    trupp.Endzeit = DateTime.Now;
    await db.SaveChangesAsync();
    return Results.Ok(trupp);
}).WithOpenApi();

app.MapPost("/api/trupps/{id:guid}/druckmessungen", async (Guid id, DruckmessungCreate dto, AppDbContext db) =>
{
    var trupp = await db.Trupps.FindAsync(id);
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

    var count = await db.Druckmessungen.CountAsync(m => m.TruppId == id && m.PersonId == dto.PersonId);
    if (count >= 3)
    {
        return Results.BadRequest(new { error = "Maximal 3 Druckmessungen pro Person." });
    }

    var messung = new Druckmessung
    {
        Id = Guid.NewGuid(),
        TruppId = id,
        PersonId = dto.PersonId,
        DruckBar = dto.DruckBar,
        Zeit = DateTime.Now
    };

    db.Druckmessungen.Add(messung);
    await db.SaveChangesAsync();
    return Results.Ok(messung);
}).WithOpenApi();

app.MapPost("/api/trupps/{id:guid}/events", async (Guid id, AlarmEventCreate dto, AppDbContext db) =>
{
    var trupp = await db.Trupps.FindAsync(id);
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
}

class Einsatz
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Ort { get; set; } = string.Empty;
    public DateTime Alarmzeit { get; set; }
    public string Status { get; set; } = "aktiv";
    public DateTime? Endzeit { get; set; }
}

class Trupp
{
    public Guid Id { get; set; }
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
    public string Name { get; set; } = string.Empty;
    public bool Aktiv { get; set; } = true;
    public int OrderIndex { get; set; }
}

class Druckmessung
{
    public Guid Id { get; set; }
    public Guid TruppId { get; set; }
    public Guid PersonId { get; set; }
    public int DruckBar { get; set; }
    public DateTime Zeit { get; set; }
}

class AlarmEvent
{
    public Guid Id { get; set; }
    public Guid TruppId { get; set; }
    public string Typ { get; set; } = string.Empty;
    public DateTime Zeit { get; set; }
    public string? Nachricht { get; set; }
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
