$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

# Das System-Secret wird nie im Repository gespeichert.
# Entweder vorher setzen:  $env:SYSTEM_SECRET = "..."
# oder beim Start eingeben.
$secret = $env:SYSTEM_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    $secure = Read-Host "SYSTEM_SECRET (mind. 16 Zeichen)" -AsSecureString
    $secret = [System.Net.NetworkCredential]::new("", $secure).Password
}
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 16) {
    Write-Error "SYSTEM_SECRET fehlt oder ist kuerzer als 16 Zeichen."
    exit 1
}

$backendCmd = "cd `"$repo\backend`"; `$env:SYSTEM_SECRET=`$env:ATS_SECRET_HANDOFF; Remove-Item Env:ATS_SECRET_HANDOFF; dotnet run"
$env:ATS_SECRET_HANDOFF = $secret
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Remove-Item Env:ATS_SECRET_HANDOFF
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo\frontend`"; npx ng serve"

Write-Host "Backend: http://localhost:5114"
Write-Host "Frontend: http://localhost:4200"
