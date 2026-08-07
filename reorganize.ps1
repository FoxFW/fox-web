<#
FoxFW web-assets reorganization script.
Run this from PowerShell on your own machine (right-click -> Run with PowerShell,
or `powershell -ExecutionPolicy Bypass -File reorganize.ps1` from a terminal).

What it does:
  1. Builds the C:\FOX_WEB folder structure (root pages, screenshots/, firmware_files/)
     by moving files out of C:\FoxFW2.0\docs.
  2. Moves the FAP-compiler workflow prep out to its own sibling repo folder,
     C:\fox-fap-compiler (word "template" dropped, per your request).
  3. Empties C:\FoxFW2.0\docs completely.
  4. Leaves git alone — see the runbook Claude gave you in chat for the
     git init / commit / push steps, which you run after reviewing this.

Safe to re-run: it skips anything already missing at the source and creates
destination folders as needed.
#>

$ErrorActionPreference = "Stop"

$DocsDir       = "C:\FoxFW2.0\docs"
$FoxWeb        = "C:\FOX_WEB"
$FirmwareFiles = Join-Path $FoxWeb "firmware_files"
$Screenshots   = Join-Path $FoxWeb "screenshots"
$FapCompiler   = "C:\fox-fap-compiler"
$FapCompilerSrc = Join-Path $DocsDir "fap-compiler-template"

function Move-IfExists($src, $destDir) {
    if (Test-Path $src) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        $name = Split-Path $src -Leaf
        $dest = Join-Path $destDir $name
        Move-Item -Force -Path $src -Destination $dest
        Write-Host "  moved: $name"
    } else {
        Write-Host "  (skip, not found) $src" -ForegroundColor DarkGray
    }
}

Write-Host "=== 1. Root pages + media -> FOX_WEB ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $FoxWeb | Out-Null
$rootFiles = @(
    "index.html",
    "flasher.html",
    "fox-esp32-flasher.html",
    "fap-compiler.html",
    "FoxESP32_Help.html",
    "FoxFW2.0.mp4",
    "FoxFW2.0.png"
)
foreach ($f in $rootFiles) {
    Move-IfExists (Join-Path $DocsDir $f) $FoxWeb
}

Write-Host "=== 2. screenshots/ -> FOX_WEB\screenshots ===" -ForegroundColor Cyan
$srcScreens = Join-Path $DocsDir "screenshots"
if (Test-Path $srcScreens) {
    New-Item -ItemType Directory -Force -Path $Screenshots | Out-Null
    Get-ChildItem -Path $srcScreens -File | ForEach-Object {
        Move-Item -Force -Path $_.FullName -Destination (Join-Path $Screenshots $_.Name)
        Write-Host "  moved: $($_.Name)"
    }
    Remove-Item -Recurse -Force $srcScreens -ErrorAction SilentlyContinue
} else {
    Write-Host "  (skip, not found) $srcScreens" -ForegroundColor DarkGray
}

Write-Host "=== 3. Firmware binaries -> FOX_WEB\firmware_files ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $FirmwareFiles | Out-Null
$firmwareFilePatterns = @(
    "boot_app0.bin",
    "firmware-classic.bootloader.bin", "firmware-classic.bin", "firmware-classic.partitions.bin",
    "firmware-s2.bootloader.bin", "firmware-s2.bin", "firmware-s2.partitions.bin",
    "firmware-s3.bootloader.bin", "firmware-s3.bin", "firmware-s3.partitions.bin",
    "firmware-c3.bootloader.bin", "firmware-c3.bin", "firmware-c3.partitions.bin",
    "firmware-c5.bootloader.bin", "firmware-c5.bin", "firmware-c5.partitions.bin",
    "firmware-c6.bootloader.bin", "firmware-c6.bin", "firmware-c6.partitions.bin",
    "flipper-z-f7-full-local.dfu",
    "flipper-z-f7-update-local.tgz"
)
foreach ($f in $firmwareFilePatterns) {
    Move-IfExists (Join-Path $DocsDir $f) $FirmwareFiles
}

Write-Host "=== 4. FAP compiler workflow -> C:\fox-fap-compiler (sibling repo) ===" -ForegroundColor Cyan
if (Test-Path $FapCompilerSrc) {
    New-Item -ItemType Directory -Force -Path $FapCompiler | Out-Null
    Get-ChildItem -Path $FapCompilerSrc -Force | ForEach-Object {
        $dest = Join-Path $FapCompiler $_.Name
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Move-Item -Force -Path $_.FullName -Destination $dest
        Write-Host "  moved: $($_.Name)"
    }
    Remove-Item -Recurse -Force $FapCompilerSrc -ErrorAction SilentlyContinue
} else {
    Write-Host "  (skip, not found) $FapCompilerSrc" -ForegroundColor DarkGray
}

Write-Host "=== 5. Emptying C:\FoxFW2.0\docs ===" -ForegroundColor Cyan
if (Test-Path $DocsDir) {
    Get-ChildItem -Path $DocsDir -Force | ForEach-Object {
        Write-Host "  leftover, removing: $($_.Name)" -ForegroundColor Yellow
        Remove-Item -Recurse -Force $_.FullName
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  C:\FOX_WEB           - website repo contents (index.html, flasher.html, firmware_files\, screenshots\, fap-compiler.html)"
Write-Host "  C:\fox-fap-compiler  - FAP compiler workflow repo contents"
Write-Host "  C:\FoxFW2.0\docs     - now empty"
Write-Host ""
Write-Host "Next: follow the git commands Claude gave you in chat to push all three."
