$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$secret = "***ENTFERNT***"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo\backend`"; `$env:SYSTEM_SECRET='$secret'; dotnet run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo\frontend`"; npx ng serve"

Write-Host "Backend: http://localhost:5114"
Write-Host "Frontend: http://localhost:52962"
