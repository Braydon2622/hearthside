# Rebuilds the real app and restarts it. -NoPause keeps it animating even while a window covers
# the desktop (for measuring the animating cost with tools/measure.ps1).
param([switch]$NoPause, [switch]$NoBuild)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:Path = "$env:LOCALAPPDATA\Programs\Git\cmd;$env:LOCALAPPDATA\Programs\nodejs;$env:USERPROFILE\.cargo\bin;$env:Path"
Get-Process hearthside -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
if (-not $NoBuild) {
  Push-Location (Join-Path $root 'src-tauri')
  cargo build 2>&1 | Select-Object -Last 3
  Pop-Location
}
if ($NoPause) { $env:HEARTHSIDE_NO_PAUSE = '1' } else { Remove-Item Env:HEARTHSIDE_NO_PAUSE -ErrorAction SilentlyContinue }
Start-Process -FilePath (Join-Path $root 'src-tauri\target\debug\hearthside.exe') -WorkingDirectory (Join-Path $root 'src-tauri')
Remove-Item Env:HEARTHSIDE_NO_PAUSE -ErrorAction SilentlyContinue
"started"
