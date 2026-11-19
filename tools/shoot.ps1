# Takes the standard set of browser screenshots of the prototype with headless Edge:
# default icons at noon, a full desktop at noon, default icons at sunset and at night,
# each at 1920x1080 and 800x600. Needs tools/serve.ps1 running.
#
#   tools/shoot.ps1 -Prefix 01-field      ->  docs/milestones/01-field-noon-1920.png, ...
param([string]$Prefix = 'shot', [string]$OutDir = '', [int]$WaitMs = 9000)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutDir) { $OutDir = Join-Path $root 'docs\milestones' }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$states = [ordered]@{ 'noon' = 'hour=12'; 'fill-noon' = 'hour=12&fill=1'; 'sunset' = 'hour=18.6'; 'night' = 'hour=22.5' }
$sizes = @(@(1920, 1080), @(800, 600))
foreach ($s in $states.Keys) {
  foreach ($sz in $sizes) {
    $profile = Join-Path $env:TEMP ('hs-shot-' + [guid]::NewGuid().ToString('N'))
    $out = Join-Path $OutDir ("$Prefix-$s-$($sz[0]).png")
    $url = "http://localhost:5173/?clean=1&$($states[$s])"
    $args = @('--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      "--user-data-dir=$profile", "--window-size=$($sz[0]),$($sz[1])", "--virtual-time-budget=$WaitMs", "--screenshot=$out", $url)
    Start-Process -FilePath $edge -ArgumentList $args -Wait -WindowStyle Hidden
    Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $out) { "$out" } else { "FAILED $out" }
  }
}
