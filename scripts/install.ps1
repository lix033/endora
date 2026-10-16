# Installe Endora sous Windows depuis les releases GitHub.
#
#   irm https://raw.githubusercontent.com/lix033/endora/main/scripts/install.ps1 | iex
#
# Variables facultatives :
#   $env:ENDORA_VERSION = '0.2.0'   version précise (défaut : dernière release)
#   $env:ENDORA_PORTABLE = '1'      version portable (zip) dans %LOCALAPPDATA%\Programs\Endora, sans installeur
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'lix033/endora'
$Version = if ($env:ENDORA_VERSION) { $env:ENDORA_VERSION.TrimStart('v') } else { 'latest' }

function Say($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# Version : la dernière release est déduite de la redirection de /releases/latest (sans API ni jeton).
if ($Version -eq 'latest') {
  $request = [System.Net.WebRequest]::Create("https://github.com/$Repo/releases/latest")
  $request.AllowAutoRedirect = $false
  $response = $request.GetResponse()
  $location = $response.Headers['Location']
  $response.Close()
  if (-not $location -or $location -notmatch '/tag/v([^/]+)$') { throw "Aucune release publiée trouvée pour $Repo." }
  $Version = $Matches[1]
}

$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  default { throw "Architecture non prise en charge : $env:PROCESSOR_ARCHITECTURE" }
}

$Base = "https://github.com/$Repo/releases/download/v$Version"
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("endora-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null

function Get-Asset($Name) {
  Say "Téléchargement de $Name"
  $path = Join-Path $Tmp $Name
  Invoke-WebRequest -Uri "$Base/$Name" -OutFile $path -UseBasicParsing
  try {
    $sums = (Invoke-WebRequest -Uri "$Base/SHA256SUMS.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match " $([regex]::Escape($Name))\s*$" } | Select-Object -First 1
    if ($line) {
      $expected = ($line -split ' ')[0].Trim().ToLower()
      $actual = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
      if ($expected -ne $actual) { throw "Empreinte SHA-256 invalide pour $Name." }
      Say 'Empreinte SHA-256 vérifiée'
    }
  } catch [System.Net.WebException] { }
  return $path
}

try {
  if ($env:ENDORA_PORTABLE -eq '1') {
    $zip = Get-Asset "Endora-$Version-win-$Arch.zip"
    $dest = Join-Path $env:LOCALAPPDATA 'Programs\Endora'
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Expand-Archive -Path $zip -DestinationPath $dest
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Endora.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    $link.TargetPath = Join-Path $dest 'Endora.exe'
    $link.Save()
    Say "Endora $Version (portable) installé dans $dest"
  } else {
    $setup = Get-Asset "Endora-Setup-$Version-$Arch.exe"
    Say 'Installation silencieuse (pour l''utilisateur courant)…'
    $process = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "L'installeur a échoué (code $($process.ExitCode))." }
    Say "Endora $Version installé. Lancez-le depuis le menu Démarrer."
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
