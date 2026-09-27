param(
    # Gespeichertes System-Secret neu festlegen (z. B. wenn es vergessen wurde).
    [switch]$ResetSecret
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$minLength = 16

# Das System-Secret wird nie im Repository gespeichert. Lokal liegt es in den .NET User-Secrets
# (%APPDATA%\Microsoft\UserSecrets\<UserSecretsId>\secrets.json) und wird nur beim ersten Start abgefragt.
# Ein vorher gesetztes $env:SYSTEM_SECRET hat Vorrang (wie in der Produktion).
[xml]$project = Get-Content "$repo\backend\backend.csproj"
$secretsId = ($project.Project.PropertyGroup | ForEach-Object { $_.UserSecretsId } | Where-Object { $_ } | Select-Object -First 1)
$secretsFile = Join-Path $env:APPDATA "Microsoft\UserSecrets\$secretsId\secrets.json"

function Read-StoredSecrets {
    if (Test-Path $secretsFile) {
        $stored = [System.IO.File]::ReadAllText($secretsFile) | ConvertFrom-Json
        if ($stored) { return $stored }
    }
    return [pscustomobject]@{}
}

function Read-NewSecret {
    # Verdeckte Eingabe, daher zweimal: ein Tippfehler faellt sonst erst beim Login im Hersteller-Portal auf.
    for ($try = 1; $try -le 3; $try++) {
        $first = [System.Net.NetworkCredential]::new("", (Read-Host "Neues SYSTEM_SECRET (mind. $minLength Zeichen)" -AsSecureString)).Password
        if ($first.Length -lt $minLength) {
            Write-Warning "Zu kurz - mindestens $minLength Zeichen."
            continue
        }
        $second = [System.Net.NetworkCredential]::new("", (Read-Host "SYSTEM_SECRET wiederholen" -AsSecureString)).Password
        if ($first -cne $second) {
            Write-Warning "Die Eingaben stimmen nicht ueberein."
            continue
        }
        return $first
    }
    Write-Error "Kein gueltiges SYSTEM_SECRET eingegeben."
    exit 1
}

if (-not [string]::IsNullOrWhiteSpace($env:SYSTEM_SECRET)) {
    if ($env:SYSTEM_SECRET.Length -lt $minLength) {
        Write-Error "`$env:SYSTEM_SECRET ist kuerzer als $minLength Zeichen."
        exit 1
    }
    Write-Host "SYSTEM_SECRET: aus der Umgebungsvariable dieser Sitzung."
    # Die Variable wird an das Backend-Fenster vererbt und hat dort Vorrang vor den User-Secrets.
} else {
    $stored = Read-StoredSecrets
    if ($ResetSecret -or [string]::IsNullOrEmpty($stored.SYSTEM_SECRET) -or $stored.SYSTEM_SECRET.Length -lt $minLength) {
        $secret = Read-NewSecret
        $stored | Add-Member -NotePropertyName SYSTEM_SECRET -NotePropertyValue $secret -Force
        New-Item -ItemType Directory -Force (Split-Path $secretsFile) | Out-Null
        [System.IO.File]::WriteAllText($secretsFile, ($stored | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
        Write-Host "SYSTEM_SECRET gespeichert in $secretsFile"
    } else {
        Write-Host "SYSTEM_SECRET: aus den User-Secrets. Vergessen? Neu festlegen mit: .\start-local.ps1 -ResetSecret"
    }
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo\backend`"; dotnet run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo\frontend`"; npx ng serve"

Write-Host "Backend: http://localhost:5114"
Write-Host "Frontend: http://localhost:4200"
Write-Host "Hersteller-Portal: http://localhost:4200/admin-login"
