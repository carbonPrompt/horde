# Builds the Windows game and installer on a Windows PC with Inno Setup 6. The build folder ($env:HORDE_BUILD,
# default C:\horde-build) holds:
#   app\    horde.html (from `bun build.ts`), main.js, preload.js, updates.js, package.json, icon.ico, installer.iss
#   tools\  rcedit-x64.exe (github.com/electron/rcedit v2.0.0)
# Output: <build folder>\out\Horde-Setup-<ver>.exe (also copied to $env:HORDE_OUT when set)
$ErrorActionPreference = "Stop"
$root = if ($env:HORDE_BUILD) { $env:HORDE_BUILD } else { "C:\horde-build" }
Set-Location $root
# rcedit v2.0.0 from github.com/electron/rcedit (sha256 3e7801db...eade2a).
$rcedit = "$root\tools\rcedit-x64.exe"
if ((Get-FileHash $rcedit).Hash -ne "3E7801DB1A5EDBEC91B49A24A094AAD776CB4515488EA5A4CA2289C400EADE2A") { throw "rcedit hash mismatch" }
if (-not (Test-Path "$root\node_modules\electron\dist\electron.exe")) {
  if (-not (Test-Path "$root\package.json")) { '{ "name": "horde-build", "private": true }' | Set-Content "$root\package.json" -Encoding ascii }
  $ErrorActionPreference = "Continue"
  cmd /c "npm install --save-exact electron@44.9.3 2>&1"
  cmd /c "node node_modules\electron\install.js 2>&1"  # newer npm can skip install scripts; fetch the Electron zip explicitly
  $ErrorActionPreference = "Stop"
  if (-not (Test-Path "$root\node_modules\electron\dist\electron.exe")) { throw "Electron download failed" }
}
$out = "$root\out"
if (Test-Path "$out\Horde") { Remove-Item "$out\Horde" -Recurse -Force }
New-Item -ItemType Directory "$out\Horde" -Force | Out-Null
Copy-Item "$root\node_modules\electron\dist\*" "$out\Horde" -Recurse
Rename-Item "$out\Horde\electron.exe" "Horde.exe"
Remove-Item "$out\Horde\resources\default_app.asar" -ErrorAction SilentlyContinue
Get-ChildItem "$out\Horde\locales" -Exclude "en-US.pak" | Remove-Item  # the game is English-only
New-Item -ItemType Directory "$out\Horde\resources\app" -Force | Out-Null
foreach ($f in "horde.html", "main.js", "preload.js", "updates.js", "package.json", "icon.ico") { Copy-Item "$root\app\$f" "$out\Horde\resources\app\" }
$ver = (Get-Content "$root\app\package.json" | ConvertFrom-Json).version
& $rcedit "$out\Horde\Horde.exe" --set-icon "$root\app\icon.ico" `
  --set-version-string ProductName Horde --set-version-string FileDescription Horde `
  --set-version-string CompanyName Horde --set-version-string OriginalFilename Horde.exe `
  --set-version-string InternalName Horde --set-file-version $ver --set-product-version $ver
if ($LASTEXITCODE) { throw "rcedit failed" }
$iscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
& $iscc /Q "/DAppVer=$ver" "$root\app\installer.iss"
if ($LASTEXITCODE) { throw "Inno Setup failed" }
if ($env:HORDE_OUT) { Copy-Item "$out\Horde-Setup-$ver.exe" $env:HORDE_OUT -Force }
Get-Item "$out\Horde-Setup-$ver.exe" | Select-Object Name, Length
