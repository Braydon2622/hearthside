# Measures how much processor time and memory the running wallpaper uses,
# counting the app itself plus the browser-engine processes it starts.
param([int]$Seconds = 10)
$app = Get-Process hearthside -ErrorAction SilentlyContinue
if (-not $app) { "Hearthside is not running."; return }
$ids = @($app.Id) + @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match 'hearthside' } | ForEach-Object { $_.ProcessId })
$before = (Get-Process -Id $ids | Measure-Object CPU -Sum).Sum
Start-Sleep -Seconds $Seconds
$procs = Get-Process -Id $ids
$after = ($procs | Measure-Object CPU -Sum).Sum
"{0} processes; CPU {1:N1}% of one core; memory {2:N0} MB" -f $ids.Count, (($after - $before) / $Seconds * 100), (($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB)
