# Packages extension/ into unsigned Chrome and Firefox zips: outputs/spellspeed-chrome.zip, outputs/spellspeed-firefox.zip.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'extension'
$outputs = Join-Path $root 'outputs'
New-Item -ItemType Directory -Path $outputs -Force | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
foreach ($browser in @('chrome','firefox')) {
    $stage = Join-Path $outputs "spellspeed-$browser"
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Get-ChildItem -LiteralPath $source -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $_.Name) -Force }
    if ($browser -eq 'firefox') {
        $firefox = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
        $firefox.background = @{scripts=@('background.js')}
        $firefox | Add-Member -NotePropertyName browser_specific_settings -NotePropertyValue @{gecko=@{id='spellspeed@spellspeed.com';strict_min_version='128.0';data_collection_permissions=@{required=@('none')}};gecko_android=@{}} -Force
        [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ($firefox | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
    }
    Get-ChildItem -LiteralPath $stage -File | Compress-Archive -DestinationPath (Join-Path $outputs "spellspeed-$browser.zip") -Force
}
Write-Output "Built Spellspeed $($manifest.version): outputs\spellspeed-chrome.zip, outputs\spellspeed-firefox.zip."
