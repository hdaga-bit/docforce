$ErrorActionPreference = "Stop"
$pkgDir = $PSScriptRoot
$tarball = Get-ChildItem -Path $pkgDir -Filter "mary-docforce-*.tgz" | Select-Object -First 1
if (-not $tarball) {
  throw "mary-docforce-*.tgz not found next to install-windows.ps1"
}
Write-Host "Installing $($tarball.Name) into the current repository..."
npm install --no-fund (Join-Path $pkgDir $tarball.Name)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Installed. From this repository run: npx docforce try"
