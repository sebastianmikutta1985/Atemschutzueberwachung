using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations.Schema;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

var systemSecret = builder.Configuration["SYSTEM_SECRET"];
if (string.IsNullOrWhiteSpace(systemSecret) || systemSecret.Length < 16)
{
    throw new InvalidOperationException(
        "SYSTEM_SECRET ist nicht gesetzt oder kuerzer als 16 Zeichen. Backend wird nicht gestartet.");
}
var systemSecretHash = SHA256.HashData(Encoding.UTF8.GetBytes(systemSecret));

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // Nur Proxys auf localhost werden standardmaessig vertraut (z. B. IIS/nginx auf demselben Host).
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddAuthentication()
    .AddScheme<AuthenticationSchemeOptions, OrgSessionHandler>(SessionAuth.OrgScheme, null)
    .AddScheme<AuthenticationSchemeOptions, SystemSessionHandler>(SessionAuth.SystemScheme, null);
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthPolicies.Org, policy => policy
        .AddAuthenticationSchemes(SessionAuth.OrgScheme)
        .RequireAuthenticatedUser())
    .AddPolicy(AuthPolicies.Admin, policy => policy
        .AddAuthenticationSchemes(SessionAuth.OrgScheme)
        .RequireRole("admin"))
    .AddPolicy(AuthPolicies.System, policy => policy
        .AddAuthenticationSchemes(SessionAuth.SystemScheme)
        .RequireRole("system"));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Begrenzt Login-Versuche pro IP. Schuetzt vor PIN-Durchprobieren und CPU-Last durch PBKDF2.
    options.AddPolicy("login", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        // Erlaubte Frontend-Origins, kommagetrennt, z. B. "https://www.crew-trace.com".
        var origins = (builder.Configuration["CORS_ORIGINS"] ?? "http://localhost:4200")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        policy.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var dataDir = Path.Combine(builder.Environment.ContentRootPath, "data");
Directory.CreateDirectory(dataDir);
var connectionString = $"Data Source={Path.Combine(dataDir, "ats.db")}";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));
builder.Services.AddSignalR();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var isNewDatabase = db.Database.EnsureCreated();
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
    await MigrateTimestampsToUtc(db, isNewDatabase, builder.Configuration["LEGACY_TIMEZONE"] ?? "Europe/Berlin");
    await MigrateSessionTokensToHash(db);
}

app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.Use(async (http, next) =>
{
    var headers = http.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    headers["Referrer-Policy"] = "no-referrer";
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
    if (http.Request.Path.StartsWithSegments("/api") || http.Request.Path.StartsWithSegments("/hubs"))
    {
        // Die API liefert nur JSON: nichts laden, nicht einbetten, nicht zwischenspeichern.
        headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
        headers.CacheControl = "no-store";
    }
    await next();
});

app.UseCors("frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Zugriffsschutz zentral ueber Policies statt Pruefung in jedem Endpunkt.
var orgApi = app.MapGroup("/api").RequireAuthorization(AuthPolicies.Org);
var adminApi = app.MapGroup("/api").RequireAuthorization(AuthPolicies.Admin);
var systemApi = app.MapGroup("/api/system").RequireAuthorization(AuthPolicies.System);

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }))
    .WithOpenApi();

app.MapHub<UpdatesHub>("/hubs/updates", options =>
    {
        // Verbindung endet, wenn die Session ablaeuft, statt unbegrenzt weiter Updates zu liefern.
        options.CloseOnAuthenticationExpiration = true;
    })
    .RequireAuthorization(AuthPolicies.Org);

// Settings (Organization defaults)
orgApi.MapGet("/settings", async (HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
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

adminApi.MapPut("/settings", async (HttpContext http, OrgSettingsUpdate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var settingsError =
        Api.CheckDruck(dto.DefaultStartdruckPerson1Bar, "Startdruck Person 1")
        ?? Api.CheckDruck(dto.DefaultStartdruckPerson2Bar, "Startdruck Person 2")
        ?? Api.CheckZeiten(dto.DefaultWarnzeitMin, dto.DefaultMaxzeitMin);
    if (settingsError != null)
    {
        return Api.Bad(settingsError);
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
    await NotifyOrgAsync(hub, auth.OrgId, "settings");
    return Results.Ok(new OrgSettingsDto(
        org.DefaultStartdruckPerson1Bar,
        org.DefaultStartdruckPerson2Bar,
        org.DefaultWarnzeitMin,
        org.DefaultMaxzeitMin
    ));
}).WithOpenApi();

// Auth
app.MapPost("/api/auth/login", async (HttpContext http, LoginRequest dto, AppDbContext db, LoginThrottle throttle) =>
{
    var code = (dto.OrgaCode ?? string.Empty).Trim().ToUpperInvariant();
    var pin = (dto.Pin ?? string.Empty).Trim();
    if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(pin) || code.Length > 32 || pin.Length > 64)
    {
        return Results.BadRequest();
    }

    var throttleKey = $"org:{http.Connection.RemoteIpAddress}:{code}";
    if (throttle.IsLocked(throttleKey, out var retryAfter))
    {
        return Api.TooManyAttempts(retryAfter);
    }

    var org = await db.Organizations.FirstOrDefaultAsync(o => o.Code == code);
    if (org == null || !string.Equals(org.Status, "aktiv", StringComparison.OrdinalIgnoreCase))
    {
        throttle.RegisterFailure(throttleKey);
        return Results.Unauthorized();
    }

    var accounts = await db.UserAccounts
        .Where(u => u.OrganizationId == org.Id && u.Active)
        .ToListAsync();
    var match = accounts.FirstOrDefault(a => VerifyPin(pin, a.PinHash));
    if (match == null)
    {
        throttle.RegisterFailure(throttleKey);
        return Results.Unauthorized();
    }
    throttle.Reset(throttleKey);

    // Abgelaufene Sessions bei Gelegenheit aufraeumen.
    await db.Sessions.Where(s => s.ExpiresAt <= DateTime.UtcNow).ExecuteDeleteAsync();

    var token = SessionAuth.NewToken();
    var session = new Session
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionAuth.HashToken(token),
        OrganizationId = org.Id,
        Role = match.Role.ToLowerInvariant(),
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddHours(12)
    };
    db.Sessions.Add(session);
    await db.SaveChangesAsync();

    // Token nur als httpOnly-Cookie: fuer JavaScript unsichtbar, ein eingeschleustes Skript kann ihn nicht auslesen.
    SessionAuth.SetSessionCookie(http, token, session.ExpiresAt, secure: http.Request.IsHttps || !app.Environment.IsDevelopment());

    return Results.Ok(new
    {
        role = match.Role,
        orgName = org.Name,
        orgCode = org.Code
    });
}).RequireRateLimiting("login").WithOpenApi();

orgApi.MapGet("/auth/me", async (HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
    return Results.Ok(new
    {
        role = auth.Role,
        orgName = auth.OrgName,
        orgCode = auth.OrgCode
    });
}).WithOpenApi();

// Bewusst ohne Autorisierung: Abmelden muss auch mit abgelaufener Session funktionieren.
app.MapPost("/api/auth/logout", async (HttpContext http, AppDbContext db) =>
{
    var token = SessionAuth.ReadToken(http.Request, "Bearer") ?? SessionAuth.ReadSessionCookie(http.Request);
    SessionAuth.ClearSessionCookie(http, secure: http.Request.IsHttps || !app.Environment.IsDevelopment());
    if (string.IsNullOrWhiteSpace(token))
    {
        return Results.Ok();
    }

    var tokenHash = SessionAuth.HashToken(token);
    await db.Sessions.Where(s => s.TokenHash == tokenHash).ExecuteDeleteAsync();
    return Results.Ok();
}).WithOpenApi();

app.MapPost("/api/system/logout", async (HttpContext http, AppDbContext db) =>
{
    var token = SessionAuth.ReadToken(http.Request, "System");
    if (string.IsNullOrWhiteSpace(token))
    {
        return Results.Ok();
    }

    var tokenHash = SessionAuth.HashToken(token);
    await db.SystemSessions.Where(s => s.TokenHash == tokenHash).ExecuteDeleteAsync();
    return Results.Ok();
}).WithOpenApi();

// Hersteller-System
app.MapPost("/api/system/login", async (HttpContext http, SystemLoginRequest dto, AppDbContext db, LoginThrottle throttle) =>
{
    var throttleKey = $"system:{http.Connection.RemoteIpAddress}";
    if (throttle.IsLocked(throttleKey, out var retryAfter))
    {
        return Api.TooManyAttempts(retryAfter);
    }
    var given = SHA256.HashData(Encoding.UTF8.GetBytes(dto.Secret ?? string.Empty));
    if (string.IsNullOrWhiteSpace(dto.Secret) || !CryptographicOperations.FixedTimeEquals(given, systemSecretHash))
    {
        throttle.RegisterFailure(throttleKey);
        return Results.Unauthorized();
    }
    throttle.Reset(throttleKey);

    await db.SystemSessions.Where(s => s.ExpiresAt <= DateTime.UtcNow).ExecuteDeleteAsync();

    var token = SessionAuth.NewToken();
    var session = new SystemSession
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionAuth.HashToken(token),
        CreatedAt = DateTime.UtcNow,
        // Hersteller-Zugang hat die hoechsten Rechte: kurze Laufzeit, passend zum Frontend.
        ExpiresAt = DateTime.UtcNow.AddMinutes(30)
    };
    db.SystemSessions.Add(session);
    await db.SaveChangesAsync();
    return Results.Ok(new { token });
}).RequireRateLimiting("login").WithOpenApi();

systemApi.MapGet("/orgs", async (HttpContext http, AppDbContext db) =>
{
    var list = await db.Organizations.OrderBy(o => o.Name).ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

systemApi.MapPost("/orgs", async (HttpContext http, OrgCreate dto, AppDbContext db) =>
{
    var name = Api.Clean(dto.Name);
    var status = string.IsNullOrWhiteSpace(dto.Status) ? "aktiv" : dto.Status.Trim().ToLowerInvariant();
    var adminPin = (dto.AdminPin ?? string.Empty).Trim();
    var userPin = (dto.UserPin ?? string.Empty).Trim();
    var createError =
        Api.CheckText(name, "Name", 200)
        ?? Api.CheckStatus(status)
        ?? Api.CheckPin(adminPin, "Admin-PIN")
        ?? Api.CheckPin(userPin, "Benutzer-PIN")
        ?? (adminPin == userPin ? "Admin-PIN und Benutzer-PIN muessen sich unterscheiden." : null);
    if (createError != null)
    {
        return Api.Bad(createError);
    }
    var code = GenerateOrgCode();
    while (await db.Organizations.AnyAsync(o => o.Code == code))
    {
        code = GenerateOrgCode();
    }
    var org = new Organization
    {
        Id = Guid.NewGuid(),
        Name = name,
        Code = code,
        Status = status,
        CreatedAt = DateTime.UtcNow
    };
    db.Organizations.Add(org);
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
    return Results.Ok(org);
}).WithOpenApi();

systemApi.MapPut("/orgs/{id:guid}", async (Guid id, HttpContext http, OrgUpdate dto, AppDbContext db) =>
{
    var org = await db.Organizations.FindAsync(id);
    if (org == null)
    {
        return Results.NotFound();
    }
    var newStatus = dto.Status?.Trim().ToLowerInvariant();
    var updateError =
        (string.IsNullOrWhiteSpace(dto.Name) ? null : Api.CheckText(Api.Clean(dto.Name), "Name", 200))
        ?? (string.IsNullOrWhiteSpace(newStatus) ? null : Api.CheckStatus(newStatus))
        ?? (string.IsNullOrWhiteSpace(dto.AdminPin) ? null : Api.CheckPin(dto.AdminPin.Trim(), "Admin-PIN"))
        ?? (string.IsNullOrWhiteSpace(dto.UserPin) ? null : Api.CheckPin(dto.UserPin.Trim(), "Benutzer-PIN"));
    if (updateError != null)
    {
        return Api.Bad(updateError);
    }
    // Gleiche PIN fuer Admin und Benutzer wuerde die Rolle beim Login mehrdeutig machen.
    var orgAccounts = await db.UserAccounts.Where(u => u.OrganizationId == id).ToListAsync();
    if ((!string.IsNullOrWhiteSpace(dto.AdminPin) && orgAccounts.Any(a => a.Role == "user" && VerifyPin(dto.AdminPin.Trim(), a.PinHash)))
        || (!string.IsNullOrWhiteSpace(dto.UserPin) && orgAccounts.Any(a => a.Role == "admin" && VerifyPin(dto.UserPin.Trim(), a.PinHash))))
    {
        return Api.Bad("Admin-PIN und Benutzer-PIN muessen sich unterscheiden.");
    }
    if (!string.IsNullOrWhiteSpace(dto.Name))
    {
        org.Name = Api.Clean(dto.Name);
    }
    if (!string.IsNullOrWhiteSpace(newStatus))
    {
        org.Status = newStatus;
        if (newStatus != "aktiv")
        {
            await db.Sessions.Where(s => s.OrganizationId == org.Id).ExecuteDeleteAsync();
        }
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

systemApi.MapDelete("/orgs/{id:guid}", async (Guid id, HttpContext http, AppDbContext db) =>
{
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
    await db.Sessions.Where(s => s.OrganizationId == id).ExecuteDeleteAsync();
    db.UserAccounts.RemoveRange(await db.UserAccounts.Where(u => u.OrganizationId == id).ToListAsync());
    db.Geraetetraeger.RemoveRange(await db.Geraetetraeger.Where(t => t.OrganizationId == id).ToListAsync());
    db.Truppnamen.RemoveRange(await db.Truppnamen.Where(t => t.OrganizationId == id).ToListAsync());
    db.Organizations.Remove(org);
    await db.SaveChangesAsync();
    return Results.Ok();
}).WithOpenApi();

// Geraetetraeger
orgApi.MapGet("/geraetetraeger", async (HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
    var list = await db.Geraetetraeger
        .Where(t => t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.Nachname)
        .ThenBy(t => t.Vorname)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

adminApi.MapPost("/geraetetraeger", async (HttpContext http, GeraetetraegerCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var personError = Api.CheckPerson(dto.Vorname, dto.Nachname, dto.Funkrufname);
    if (personError != null)
    {
        return Api.Bad(personError);
    }
    var entity = new Geraetetraeger
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Vorname = Api.Clean(dto.Vorname),
        Nachname = Api.Clean(dto.Nachname),
        Funkrufname = string.IsNullOrWhiteSpace(dto.Funkrufname) ? null : Api.Clean(dto.Funkrufname),
        Aktiv = dto.Aktiv
    };

    db.Geraetetraeger.Add(entity);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "geraetetraeger");
    return Results.Ok(entity);
}).WithOpenApi();

adminApi.MapPut("/geraetetraeger/{id:guid}", async (Guid id, HttpContext http, GeraetetraegerUpdate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var entity = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    var personError = Api.CheckPerson(dto.Vorname, dto.Nachname, dto.Funkrufname);
    if (personError != null)
    {
        return Api.Bad(personError);
    }
    entity.Vorname = Api.Clean(dto.Vorname);
    entity.Nachname = Api.Clean(dto.Nachname);
    entity.Funkrufname = string.IsNullOrWhiteSpace(dto.Funkrufname) ? null : Api.Clean(dto.Funkrufname);
    entity.Aktiv = dto.Aktiv;

    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "geraetetraeger");
    return Results.Ok(entity);
}).WithOpenApi();

adminApi.MapDelete("/geraetetraeger/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var entity = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Geraetetraeger.Remove(entity);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "geraetetraeger");
    return Results.Ok();
}).WithOpenApi();

// Truppnamen (Vorlagen)
orgApi.MapGet("/truppnamen", async (HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
    var list = await db.Truppnamen
        .Where(t => t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.OrderIndex)
        .ThenBy(t => t.Name)
        .ToListAsync();
    return Results.Ok(list);
}).WithOpenApi();

adminApi.MapPost("/truppnamen", async (HttpContext http, TruppNameCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var nameError = Api.CheckText(Api.Clean(dto.Name), "Truppname", 100);
    if (nameError != null)
    {
        return Api.Bad(nameError);
    }
    var nextOrder = await db.Truppnamen.Where(t => t.OrganizationId == auth.OrgId).MaxAsync(t => (int?)t.OrderIndex) ?? 0;
    var entity = new TruppName
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Name = Api.Clean(dto.Name),
        Aktiv = dto.Aktiv,
        OrderIndex = nextOrder + 1
    };

    db.Truppnamen.Add(entity);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "truppnamen");
    return Results.Ok(entity);
}).WithOpenApi();

adminApi.MapPut("/truppnamen/{id:guid}", async (Guid id, HttpContext http, TruppNameUpdate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var entity = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    var nameError = Api.CheckText(Api.Clean(dto.Name), "Truppname", 100);
    if (nameError != null)
    {
        return Api.Bad(nameError);
    }
    entity.Name = Api.Clean(dto.Name);
    entity.Aktiv = dto.Aktiv;
    entity.OrderIndex = dto.OrderIndex;
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "truppnamen");
    return Results.Ok(entity);
}).WithOpenApi();

adminApi.MapDelete("/truppnamen/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var entity = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (entity == null)
    {
        return Results.NotFound();
    }

    db.Truppnamen.Remove(entity);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "truppnamen");
    return Results.Ok();
}).WithOpenApi();

adminApi.MapPost("/truppnamen/reorder", async (HttpContext http, TruppNameReorder dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
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
    await NotifyOrgAsync(hub, auth.OrgId, "truppnamen");
    return Results.Ok();
}).WithOpenApi();

// Einsatz
orgApi.MapPost("/einsaetze", async (HttpContext http, EinsatzCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var einsatzError = Api.CheckText(Api.Clean(dto.Name), "Einsatzname", 200) ?? Api.CheckText(Api.Clean(dto.Ort), "Ort", 200);
    if (einsatzError != null)
    {
        return Api.Bad(einsatzError);
    }
    var einsatz = new Einsatz
    {
        Id = Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        Name = Api.Clean(dto.Name),
        Ort = Api.Clean(dto.Ort),
        Alarmzeit = Api.ToUtc(dto.Alarmzeit) ?? DateTime.UtcNow,
        Status = "aktiv"
    };

    db.Einsaetze.Add(einsatz);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "einsatz");
    return Results.Ok(einsatz);
}).WithOpenApi();

orgApi.MapGet("/einsaetze/aktiv", async (HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
    var aktive = await db.Einsaetze
        .Where(e => e.OrganizationId == auth.OrgId && e.Status == "aktiv")
        .OrderByDescending(e => e.Alarmzeit)
        .ToListAsync();
    return Results.Ok(aktive);
}).WithOpenApi();

orgApi.MapGet("/einsaetze/letzte", async (HttpContext http, int? limit, AppDbContext db) =>
{
    var auth = http.GetAuth();
    var take = Math.Clamp(limit ?? 10, 1, 50);
    var letzte = await db.Einsaetze
        .Where(e => e.OrganizationId == auth.OrgId)
        .OrderByDescending(e => e.Alarmzeit)
        .Take(take)
        .ToListAsync();
    return Results.Ok(letzte);
}).WithOpenApi();

orgApi.MapPost("/einsaetze/{id:guid}/beenden", async (Guid id, HttpContext http, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == id && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }

    var now = DateTime.UtcNow;
    einsatz.Status = "beendet";
    einsatz.Endzeit = now;

    var offeneTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id && t.Endzeit == null && t.OrganizationId == auth.OrgId)
        .ToListAsync();

    foreach (var trupp in offeneTrupps)
    {
        trupp.Endzeit = now;
    }

    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "einsatz");
    return Results.Ok(einsatz);
}).WithOpenApi();

adminApi.MapDelete("/einsaetze/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == id && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }
    if (einsatz.Status == "aktiv")
    {
        return Api.Bad("Ein aktiver Einsatz kann nicht geloescht werden. Bitte zuerst beenden.");
    }

    var relatedTrupps = await db.Trupps
        .Where(t => t.EinsatzId == id && t.OrganizationId == auth.OrgId)
        .ToListAsync();
    var relatedTruppIds = relatedTrupps.Select(t => t.Id).ToArray();

    db.Druckmessungen.RemoveRange(await db.Druckmessungen
        .Where(m => m.OrganizationId == auth.OrgId && relatedTruppIds.Contains(m.TruppId))
        .ToListAsync());
    db.AlarmEvents.RemoveRange(await db.AlarmEvents
        .Where(e => e.OrganizationId == auth.OrgId && relatedTruppIds.Contains(e.TruppId))
        .ToListAsync());
    db.Trupps.RemoveRange(relatedTrupps);

    db.Einsaetze.Remove(einsatz);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "einsatz");
    return Results.Ok();
}).WithOpenApi();

// Trupps
orgApi.MapPost("/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, HttpContext http, TruppCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var einsatz = await db.Einsaetze.FirstOrDefaultAsync(e => e.Id == einsatzId && e.OrganizationId == auth.OrgId);
    if (einsatz == null)
    {
        return Results.NotFound();
    }
    if (einsatz.Status != "aktiv")
    {
        return Api.Bad("Einsatz ist bereits beendet.");
    }
    if (dto.Person1Id == dto.Person2Id)
    {
        return Api.Bad("Person 1 und Person 2 muessen unterschiedlich sein.");
    }

    var person1 =await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == dto.Person1Id && t.OrganizationId == auth.OrgId);
    var person2 = await db.Geraetetraeger.FirstOrDefaultAsync(t => t.Id == dto.Person2Id && t.OrganizationId == auth.OrgId);
    var truppName = await db.Truppnamen.FirstOrDefaultAsync(t => t.Id == dto.TruppNameId && t.OrganizationId == auth.OrgId);
    var orgDefaults = await db.Organizations.FirstOrDefaultAsync(o => o.Id == auth.OrgId);

    if (person1 == null || person2 == null || truppName == null)
    {
        return Results.BadRequest(new { error = "Trupp und Personen muessen aus der Liste gewaehlt werden." });
    }
    if (!person1.Aktiv || !person2.Aktiv || !truppName.Aktiv)
    {
        return Api.Bad("Inaktive Personen oder Truppnamen koennen nicht eingesetzt werden.");
    }

    var defP1 = orgDefaults?.DefaultStartdruckPerson1Bar ?? 300;
    var defP2 = orgDefaults?.DefaultStartdruckPerson2Bar ?? 300;
    var defWarn = orgDefaults?.DefaultWarnzeitMin ?? 25;
    var defMax = orgDefaults?.DefaultMaxzeitMin ?? 30;

    var startP1 = dto.StartdruckPerson1Bar > 0 ? dto.StartdruckPerson1Bar : defP1;
    var startP2 = dto.StartdruckPerson2Bar > 0 ? dto.StartdruckPerson2Bar : defP2;
    var warnMin = dto.WarnzeitMin > 0 ? dto.WarnzeitMin : defWarn;
    var maxMin = dto.MaxzeitMin > 0 ? dto.MaxzeitMin : defMax;

    var truppError =
        Api.CheckDruck(startP1, "Startdruck Person 1")
        ?? Api.CheckDruck(startP2, "Startdruck Person 2")
        ?? Api.CheckZeiten(warnMin, maxMin);
    if (truppError != null)
    {
        return Api.Bad(truppError);
    }

    var aktiveTrupps = await db.Trupps
        .Where(t => t.OrganizationId == auth.OrgId && t.Endzeit == null)
        .ToListAsync();
    if (aktiveTrupps.Any(t => t.Person1Id == person1.Id || t.Person2Id == person1.Id
        || t.Person1Id == person2.Id || t.Person2Id == person2.Id))
    {
        return Api.Bad("Eine der Personen ist bereits in einem aktiven Trupp.");
    }
    if (aktiveTrupps.Any(t => t.EinsatzId == einsatzId && t.Bezeichnung == truppName.Name))
    {
        return Api.Bad("Dieser Trupp ist in diesem Einsatz bereits aktiv.");
    }

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
        Startzeit = Api.ToUtc(dto.Startzeit) ?? DateTime.UtcNow,
        WarnzeitMin = warnMin,
        MaxzeitMin = maxMin
    };

    db.Trupps.Add(trupp);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "trupp");
    return Results.Ok(trupp);
}).WithOpenApi();

orgApi.MapGet("/einsaetze/{einsatzId:guid}/trupps", async (Guid einsatzId, HttpContext http, AppDbContext db) =>
{
    var auth = http.GetAuth();
    var trupps = await db.Trupps
        .Where(t => t.EinsatzId == einsatzId && t.OrganizationId == auth.OrgId)
        .OrderBy(t => t.Startzeit)
        .ToListAsync();

    var truppIds = trupps.Select(t => t.Id).ToArray();
    var messungen = await db.Druckmessungen
        .Where(m => m.OrganizationId == auth.OrgId && truppIds.Contains(m.TruppId))
        .OrderByDescending(m => m.Zeit)
        .ToListAsync();
    var alarmEvents = await db.AlarmEvents
        .Where(e => e.OrganizationId == auth.OrgId && truppIds.Contains(e.TruppId))
        .OrderByDescending(e => e.Zeit)
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
        var warnAcked = alarmEvents.Any(e => e.TruppId == t.Id && e.Typ == "warn_ack");
        var maxAcked = alarmEvents.Any(e => e.TruppId == t.Id && e.Typ == "max_ack");

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
            p2,
            warnAcked,
            maxAcked
        );
    }).ToList();

    return Results.Ok(result);
}).WithOpenApi();

orgApi.MapPost("/trupps/{id:guid}/beenden", async (Guid id, HttpContext http, TruppEnd? dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    // Idempotent: ein bereits beendeter Trupp behaelt sein erstes Ende (auch bei wiederholter Uebertragung).
    if (trupp.Endzeit == null)
    {
        var timeError = Api.CheckClientTime(dto?.Endzeit, trupp.Startzeit, out var endzeit);
        if (timeError != null)
        {
            return Api.Bad(timeError);
        }
        trupp.Endzeit = endzeit;
    }
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "trupp");
    return Results.Ok(trupp);
}).WithOpenApi();

orgApi.MapPost("/trupps/{id:guid}/druckmessungen", async (Guid id, HttpContext http, DruckmessungCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    if (dto.PersonId != trupp.Person1Id && dto.PersonId != trupp.Person2Id)
    {
        return Results.BadRequest(new { error = "Person gehoert nicht zu diesem Trupp." });
    }

    // Wiederholte Uebertragung aus der Offline-Warteschlange (Antwort ging verloren): nichts doppelt anlegen.
    if (dto.Id is { } clientId)
    {
        var existing = await db.Druckmessungen.FirstOrDefaultAsync(m => m.Id == clientId);
        if (existing != null)
        {
            return existing.OrganizationId == auth.OrgId && existing.TruppId == id
                && existing.PersonId == dto.PersonId && existing.DruckBar == dto.DruckBar
                ? Results.Ok(existing)
                : Results.Conflict(new { error = "Diese Messungs-ID ist bereits vergeben." });
        }
    }

    var timeError = Api.CheckClientTime(dto.Zeit, trupp.Startzeit, out var zeit);
    if (timeError != null)
    {
        return Api.Bad(timeError);
    }
    // Eine Messung von vor dem Trupp-Ende darf nachgereicht werden (z. B. offline erfasst).
    if (trupp.Endzeit != null && zeit > trupp.Endzeit)
    {
        return Results.BadRequest(new { error = "Trupp ist bereits beendet." });
    }

    var bisherige = (await db.Druckmessungen
        .Where(m => m.OrganizationId == auth.OrgId && m.TruppId == id && m.PersonId == dto.PersonId)
        .ToListAsync())
        .OrderBy(m => m.Zeit)
        .ToList();
    if (bisherige.Count >= 3)
    {
        return Results.BadRequest(new { error = "Maximal 3 Druckmessungen pro Person." });
    }

    // Der Druck kann nur sinken – zeitlich geprueft, damit nachgereichte Messungen richtig eingeordnet werden:
    // hoechstens die Messung davor (bzw. der Startdruck), mindestens die Messung danach.
    var vorher = bisherige.LastOrDefault(m => m.Zeit <= zeit);
    var danach = bisherige.FirstOrDefault(m => m.Zeit > zeit);
    var maxDruck = vorher?.DruckBar
        ?? (dto.PersonId == trupp.Person1Id ? trupp.StartdruckPerson1Bar : trupp.StartdruckPerson2Bar);
    var minDruck = Math.Max(1, danach?.DruckBar ?? 1);
    if (dto.DruckBar < minDruck || dto.DruckBar > maxDruck)
    {
        return Api.Bad($"Druck muss zwischen {minDruck} und {maxDruck} bar liegen.");
    }

    var messung = new Druckmessung
    {
        Id = dto.Id ?? Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        TruppId = id,
        PersonId = dto.PersonId,
        DruckBar = dto.DruckBar,
        Zeit = zeit
    };

    db.Druckmessungen.Add(messung);
    await db.SaveChangesAsync();
    await NotifyOrgAsync(hub, auth.OrgId, "druck");
    return Results.Ok(messung);
}).WithOpenApi();

orgApi.MapPost("/trupps/{id:guid}/events", async (Guid id, HttpContext http, AlarmEventCreate dto, AppDbContext db, IHubContext<UpdatesHub> hub) =>
{
    var auth = http.GetAuth();
    var trupp = await db.Trupps.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == auth.OrgId);
    if (trupp == null)
    {
        return Results.NotFound();
    }

    var type = (dto.Typ ?? string.Empty).Trim().ToLowerInvariant();
    if (type is not ("warn" or "max" or "warn_ack" or "max_ack"))
    {
        return Results.BadRequest(new { error = "Unbekannter Event-Typ." });
    }
    var nachricht = string.IsNullOrWhiteSpace(dto.Nachricht) ? null : Api.Clean(dto.Nachricht);
    if (nachricht?.Length > 500)
    {
        return Api.Bad("Nachricht darf hoechstens 500 Zeichen lang sein.");
    }

    // Wiederholte Uebertragung aus der Offline-Warteschlange: nichts doppelt anlegen.
    if (dto.Id is { } clientId)
    {
        var existing = await db.AlarmEvents.FirstOrDefaultAsync(e => e.Id == clientId);
        if (existing != null)
        {
            return existing.OrganizationId == auth.OrgId && existing.TruppId == id && existing.Typ == type
                ? Results.Ok(existing)
                : Results.Conflict(new { error = "Diese Event-ID ist bereits vergeben." });
        }
    }

    var timeError = Api.CheckClientTime(dto.Zeit, trupp.Startzeit, out var zeit);
    if (timeError != null)
    {
        return Api.Bad(timeError);
    }

    var ev = new AlarmEvent
    {
        Id = dto.Id ?? Guid.NewGuid(),
        OrganizationId = auth.OrgId,
        TruppId = id,
        Typ = type,
        Zeit = zeit,
        Nachricht = nachricht
    };

    db.AlarmEvents.Add(ev);
    await db.SaveChangesAsync();
    if (type.EndsWith("_ack"))
    {
        // Quittierung auf allen Geraeten der Organisation sichtbar machen.
        await NotifyOrgAsync(hub, auth.OrgId, "trupp");
    }
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
        // Zufaellige Start-PINs statt fester Standardwerte; werden nur dieses eine Mal ausgegeben.
        var adminPin = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var userPin = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        while (userPin == adminPin)
        {
            userPin = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        }
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
        Console.WriteLine($"[BOOTSTRAP] Initial-PINs (bitte notieren und ueber das Hersteller-Portal aendern). Admin: {adminPin}, User: {userPin}");
    }
}

// Frueher wurden Einsatz-/Trupp-/Messzeiten als lokale Serverzeit ohne Zeitzone gespeichert.
// Einmalige Umrechnung nach UTC; der Stand wird ueber PRAGMA user_version markiert.
static async Task MigrateTimestampsToUtc(AppDbContext db, bool isNewDatabase, string legacyTimeZoneId)
{
    const int utcSchemaVersion = 1;
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using (var cmd = connection.CreateCommand())
    {
        cmd.CommandText = "PRAGMA user_version;";
        var version = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        if (version >= utcSchemaVersion)
        {
            return;
        }
    }

    if (!isNewDatabase)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(legacyTimeZoneId);
        DateTime ToUtc(DateTime wallClock) =>
            TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(wallClock, DateTimeKind.Unspecified), tz);

        await using var tx = await db.Database.BeginTransactionAsync();
        foreach (var e in await db.Einsaetze.ToListAsync())
        {
            e.Alarmzeit = ToUtc(e.Alarmzeit);
            e.Endzeit = e.Endzeit is { } end ? ToUtc(end) : null;
        }
        foreach (var t in await db.Trupps.ToListAsync())
        {
            t.Startzeit = ToUtc(t.Startzeit);
            t.Endzeit = t.Endzeit is { } end ? ToUtc(end) : null;
        }
        foreach (var m in await db.Druckmessungen.ToListAsync())
        {
            m.Zeit = ToUtc(m.Zeit);
        }
        foreach (var a in await db.AlarmEvents.ToListAsync())
        {
            a.Zeit = ToUtc(a.Zeit);
        }
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        Console.WriteLine($"[MIGRATION] Zeitstempel von {legacyTimeZoneId} nach UTC umgerechnet.");
    }

    await db.Database.ExecuteSqlRawAsync($"PRAGMA user_version = {utcSchemaVersion};");
}

// Frueher lagen Session-Tokens im Klartext in der Datenbank; einmalig durch ihren Hash ersetzen.
static async Task MigrateSessionTokensToHash(AppDbContext db)
{
    const int hashedTokensSchemaVersion = 2;
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
    {
        await connection.OpenAsync();
    }

    await using (var cmd = connection.CreateCommand())
    {
        cmd.CommandText = "PRAGMA user_version;";
        var version = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        if (version >= hashedTokensSchemaVersion)
        {
            return;
        }
    }

    await using var tx = await db.Database.BeginTransactionAsync();
    foreach (var s in await db.Sessions.ToListAsync())
    {
        s.TokenHash = SessionAuth.HashToken(s.TokenHash);
    }
    foreach (var s in await db.SystemSessions.ToListAsync())
    {
        s.TokenHash = SessionAuth.HashToken(s.TokenHash);
    }
    await db.SaveChangesAsync();
    await db.Database.ExecuteSqlRawAsync($"PRAGMA user_version = {hashedTokensSchemaVersion};");
    await tx.CommitAsync();
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
    // Neue PIN beendet alle bestehenden Sessions dieser Rolle.
    await db.Sessions.Where(s => s.OrganizationId == orgId && s.Role == role).ExecuteDeleteAsync();
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

static async Task NotifyOrgAsync(IHubContext<UpdatesHub> hub, Guid orgId, string type)
{
    await hub.Clients.Group($"org-{orgId}").SendAsync("update", type);
}

static class AuthPolicies
{
    public const string Org = "org";
    public const string Admin = "admin";
    public const string System = "system";
}

static class SessionAuth
{
    public const string OrgScheme = "OrgSession";
    public const string SystemScheme = "SystemSession";
    public const string OrgIdClaim = "org_id";
    public const string OrgNameClaim = "org_name";
    public const string OrgCodeClaim = "org_code";

    public static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    // In der Datenbank liegt nur der Hash; ein Datenbank-Leck liefert so keine gueltigen Tokens.
    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string? ReadToken(HttpRequest request, string prefix)
    {
        var header = request.Headers.Authorization.ToString();
        if (header.StartsWith(prefix + " ", StringComparison.OrdinalIgnoreCase))
        {
            var token = header[(prefix.Length + 1)..].Trim();
            return string.IsNullOrWhiteSpace(token) ? null : token;
        }
        return null;
    }

    // Browser-Sessions laufen ueber ein httpOnly-Cookie (auch fuer den SignalR-Hub, daher keine Tokens mehr in URLs).
    public const string SessionCookie = "ats_session";
    // Aendernde Anfragen mit Cookie-Anmeldung muessen diesen Header tragen. Fremde Seiten koennen ihn nicht setzen
    // (Schutz vor CSRF zusaetzlich zu SameSite=Strict).
    public const string CsrfHeader = "X-Requested-With";

    public static string? ReadSessionCookie(HttpRequest request) =>
        request.Cookies.TryGetValue(SessionCookie, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    public static void SetSessionCookie(HttpContext http, string token, DateTime expiresUtc, bool secure) =>
        http.Response.Cookies.Append(SessionCookie, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = expiresUtc,
            IsEssential = true
        });

    public static void ClearSessionCookie(HttpContext http, bool secure) =>
        http.Response.Cookies.Delete(SessionCookie, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/"
        });

    public static AuthContext GetAuth(this HttpContext http)
    {
        var user = http.User;
        return new AuthContext(
            Guid.Parse(user.FindFirstValue(OrgIdClaim)!),
            user.FindFirstValue(ClaimTypes.Role)!,
            user.FindFirstValue(OrgNameClaim)!,
            user.FindFirstValue(OrgCodeClaim)!);
    }
}

class OrgSessionHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AppDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = SessionAuth.ReadToken(Request, "Bearer");
        if (token == null)
        {
            token = SessionAuth.ReadSessionCookie(Request);
            if (token == null)
            {
                return AuthenticateResult.NoResult();
            }
            var readOnly = HttpMethods.IsGet(Request.Method) || HttpMethods.IsHead(Request.Method) || HttpMethods.IsOptions(Request.Method);
            if (!readOnly && !Request.Headers.ContainsKey(SessionAuth.CsrfHeader))
            {
                return AuthenticateResult.Fail("CSRF-Header fehlt.");
            }
        }

        var tokenHash = SessionAuth.HashToken(token);
        var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.TokenHash == tokenHash);
        if (session == null || session.ExpiresAt <= DateTime.UtcNow)
        {
            return AuthenticateResult.Fail("Session ungueltig oder abgelaufen.");
        }

        var org = await db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == session.OrganizationId);
        if (org == null || !string.Equals(org.Status, "aktiv", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.Fail("Organisation nicht aktiv.");
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Role, session.Role),
                new Claim(SessionAuth.OrgIdClaim, org.Id.ToString()),
                new Claim(SessionAuth.OrgNameClaim, org.Name),
                new Claim(SessionAuth.OrgCodeClaim, org.Code)
            ],
            Scheme.Name);
        var properties = new AuthenticationProperties { ExpiresUtc = session.ExpiresAt };
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), properties, Scheme.Name));
    }
}

class SystemSessionHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AppDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = SessionAuth.ReadToken(Request, "System");
        if (token == null)
        {
            return AuthenticateResult.NoResult();
        }

        var tokenHash = SessionAuth.HashToken(token);
        var session = await db.SystemSessions.AsNoTracking().FirstOrDefaultAsync(s => s.TokenHash == tokenHash);
        if (session == null || session.ExpiresAt <= DateTime.UtcNow)
        {
            return AuthenticateResult.Fail("Session ungueltig oder abgelaufen.");
        }

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, "system")], Scheme.Name);
        var properties = new AuthenticationProperties { ExpiresUtc = session.ExpiresAt };
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), properties, Scheme.Name));
    }
}

static class Api
{
    public const int MinPinLength = 6;
    public const int MaxDruckBar = 400;
    public const int MaxZeitMin = 240;

    public static IResult Forbidden() =>
        Results.Json(new { error = "Keine Berechtigung." }, statusCode: StatusCodes.Status403Forbidden);

    public static IResult Bad(string error) => Results.BadRequest(new { error });

    public static IResult TooManyAttempts(TimeSpan retryAfter) =>
        Results.Json(
            new { error = $"Zu viele Fehlversuche. Bitte in {Math.Max(1, (int)Math.Ceiling(retryAfter.TotalMinutes))} Minuten erneut versuchen." },
            statusCode: StatusCodes.Status429TooManyRequests);

    public static string Clean(string? value) => (value ?? string.Empty).Trim();

    public static string? CheckText(string value, string field, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return $"{field} ist ein Pflichtfeld.";
        if (value.Length > maxLength) return $"{field} darf hoechstens {maxLength} Zeichen lang sein.";
        return null;
    }

    public static string? CheckPerson(string? vorname, string? nachname, string? funkrufname) =>
        CheckText(Clean(vorname), "Vorname", 100)
        ?? CheckText(Clean(nachname), "Nachname", 100)
        ?? (Clean(funkrufname).Length > 100 ? "Funkrufname darf hoechstens 100 Zeichen lang sein." : null);

    public static string? CheckDruck(int druckBar, string field) =>
        druckBar is < 1 or > MaxDruckBar ? $"{field} muss zwischen 1 und {MaxDruckBar} bar liegen." : null;

    public static string? CheckZeiten(int warnzeitMin, int maxzeitMin)
    {
        if (warnzeitMin is < 1 or > MaxZeitMin || maxzeitMin is < 1 or > MaxZeitMin)
        {
            return $"Warn- und Maximalzeit muessen zwischen 1 und {MaxZeitMin} Minuten liegen.";
        }
        return warnzeitMin >= maxzeitMin ? "Warnzeit muss kleiner als die Maximalzeit sein." : null;
    }

    public static string? CheckStatus(string status) =>
        status is "aktiv" or "gesperrt" ? null : "Status muss 'aktiv' oder 'gesperrt' sein.";

    public static string? CheckPin(string pin, string field)
    {
        if (pin.Length < MinPinLength) return $"{field} muss mindestens {MinPinLength} Zeichen haben.";
        if (pin.Length > 64) return $"{field} darf hoechstens 64 Zeichen haben.";
        return null;
    }

    // Erfassungszeit einer Eingabe, die offline gespeichert und spaeter uebertragen wurde. Die Geraeteuhr ist mit
    // dem Server abgeglichen; plausibel ist die Zeit nicht vor dem Truppstart, hoechstens 24 h alt und nicht mehr
    // als 2 min in der Zukunft (leichte Abweichungen werden auf "jetzt" begrenzt). Ohne Angabe gilt die Serverzeit.
    public static string? CheckClientTime(DateTime? clientTime, DateTime notBefore, out DateTime result)
    {
        var now = DateTime.UtcNow;
        result = now;
        if (clientTime == null)
        {
            return null;
        }
        var time = ToUtc(clientTime)!.Value;
        if (time > now.AddMinutes(2)) return "Der Zeitstempel liegt in der Zukunft.";
        if (time < now.AddHours(-24)) return "Der Zeitstempel ist aelter als 24 Stunden.";
        if (time < notBefore.AddMinutes(-1)) return "Der Zeitstempel liegt vor dem Beginn des Trupps.";
        result = time > now ? now : time;
        return null;
    }

    // Zeitangaben vom Client kommen als ISO-String mit "Z" oder Offset. Werte ohne Angabe gelten als UTC.
    public static DateTime? ToUtc(DateTime? value) => value switch
    {
        null => null,
        { Kind: DateTimeKind.Utc } v => v,
        { Kind: DateTimeKind.Local } v => v.ToUniversalTime(),
        { } v => DateTime.SpecifyKind(v, DateTimeKind.Utc)
    };
}

// Sperrt nach zu vielen Fehlversuchen pro Schluessel (IP + Orga-Code) fuer ein Zeitfenster.
// Bewusst nicht nur pro Orga-Code, damit ein Angreifer eine Feuerwehr nicht im Einsatz aussperren kann.
sealed class LoginThrottle
{
    private const int MaxFailures = 10;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private readonly ConcurrentDictionary<string, (int Count, DateTime FirstFailure)> _failures = new();

    public bool IsLocked(string key, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;
        if (!_failures.TryGetValue(key, out var entry))
        {
            return false;
        }
        var elapsed = DateTime.UtcNow - entry.FirstFailure;
        if (elapsed >= Window)
        {
            _failures.TryRemove(key, out _);
            return false;
        }
        if (entry.Count < MaxFailures)
        {
            return false;
        }
        retryAfter = Window - elapsed;
        return true;
    }

    public void RegisterFailure(string key)
    {
        var now = DateTime.UtcNow;
        _failures.AddOrUpdate(
            key,
            _ => (1, now),
            (_, e) => now - e.FirstFailure >= Window ? (1, now) : (e.Count + 1, e.FirstFailure));

        if (_failures.Count > 10_000)
        {
            foreach (var item in _failures.Where(f => now - f.Value.FirstFailure >= Window))
            {
                _failures.TryRemove(item.Key, out _);
            }
        }
    }

    public void Reset(string key) => _failures.TryRemove(key, out _);
}

class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // Alle Zeitstempel werden als UTC gespeichert und beim Lesen als UTC markiert,
    // damit die API sie mit "Z" ausliefert und Clients sie korrekt in Ortszeit umrechnen.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
    }

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

class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
{
    public UtcDateTimeConverter()
        : base(
            v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v,
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc))
    {
    }
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
    [Column("Token")]
    public string TokenHash { get; set; } = string.Empty;
    public Guid OrganizationId { get; set; }
    public string Role { get; set; } = "user";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

class SystemSession
{
    public Guid Id { get; set; }
    [Column("Token")]
    public string TokenHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

record EinsatzCreate(string? Name, string? Ort, DateTime? Alarmzeit);
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
record GeraetetraegerCreate(string? Vorname, string? Nachname, string? Funkrufname, bool Aktiv);
record GeraetetraegerUpdate(string? Vorname, string? Nachname, string? Funkrufname, bool Aktiv);
record TruppNameCreate(string? Name, bool Aktiv);
record TruppNameUpdate(string? Name, bool Aktiv, int OrderIndex);
record TruppNameReorder(Guid[] Ids);
// Id und Zeit sind optional: gesetzt von der Offline-Warteschlange des Frontends (idempotent, Erfassungszeit).
record DruckmessungCreate(Guid PersonId, int DruckBar, Guid? Id = null, DateTime? Zeit = null);
record AlarmEventCreate(string? Typ, string? Nachricht, Guid? Id = null, DateTime? Zeit = null);
record TruppEnd(DateTime? Endzeit);
record LoginRequest(string? OrgaCode, string? Pin);
record SystemLoginRequest(string? Secret);
record OrgSettingsDto(int DefaultStartdruckPerson1Bar, int DefaultStartdruckPerson2Bar, int DefaultWarnzeitMin, int DefaultMaxzeitMin);
record OrgSettingsUpdate(int DefaultStartdruckPerson1Bar, int DefaultStartdruckPerson2Bar, int DefaultWarnzeitMin, int DefaultMaxzeitMin);
record OrgCreate(string? Name, string? AdminPin, string? UserPin, string? Status);
record OrgUpdate(string? Name, string? AdminPin, string? UserPin, string? Status);
record AuthContext(Guid OrgId, string Role, string OrgName, string OrgCode);

// Zugriff wird ueber RequireAuthorization beim MapHub erzwungen.
class UpdatesHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        if (!Guid.TryParse(Context.User?.FindFirstValue(SessionAuth.OrgIdClaim), out var orgId))
        {
            Context.Abort();
            return;
        }
        Context.Items["orgId"] = orgId;
        await Groups.AddToGroupAsync(Context.ConnectionId, $"org-{orgId}");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue("orgId", out var orgValue) && orgValue is Guid orgId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"org-{orgId}");
        }
        await base.OnDisconnectedAsync(exception);
    }
}

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
    DruckInfo[] DruckMessungenPerson2,
    bool WarnAcked,
    bool MaxAcked
);

record DruckInfo(int DruckBar, DateTime Zeit);

