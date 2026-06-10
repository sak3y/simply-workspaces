# ============================================================================
# dev-run.ps1 — launch the Workspace extension under web-ext, the RIGHT way
# ============================================================================
#
# Plain `web-ext run` uses a throwaway profile, so:
#   * workspaces you create disappear on the next launch (no persistence), and
#   * userChrome.css is not active (so Firefox's sidebar header stays unstyled).
#
# This script fixes both:
#   1. --keep-profile-changes + a persistent profile dir  -> storage.local
#      (your workspaces) survives across runs and restarts.
#   2. Copies userChrome.css into the profile's chrome/ folder and enables the
#      customization pref -> the native sidebar "Workspaces" title is shrunk
#      and the x button gets a pointer cursor.
#
# Usage:   .\dev-run.ps1
# ============================================================================

$ErrorActionPreference = 'Stop'
$root       = $PSScriptRoot
$profileDir = Join-Path $root '.ff-dev-profile'
$chromeDir  = Join-Path $profileDir 'chrome'

# Ensure the profile + chrome folder exist, and install userChrome.css.
New-Item -ItemType Directory -Force -Path $chromeDir | Out-Null
Copy-Item (Join-Path $root 'userChrome\userChrome.css') `
          (Join-Path $chromeDir 'userChrome.css') -Force

Write-Host "Launching web-ext with persistent profile: $profileDir" -ForegroundColor Cyan

web-ext run `
  --firefox-profile $profileDir `
  --keep-profile-changes `
  --pref toolkit.legacyUserProfileCustomizations.stylesheets=true `
  --browser-console
