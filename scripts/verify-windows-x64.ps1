param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath
)

$ErrorActionPreference = 'Stop'

function Get-PeMachineName {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [IO.File]::OpenRead($Path)
  try {
    $reader = [IO.BinaryReader]::new($stream)
    $stream.Seek(0x3c, [IO.SeekOrigin]::Begin) | Out-Null
    $peOffset = $reader.ReadInt32()
    $stream.Seek($peOffset + 4, [IO.SeekOrigin]::Begin) | Out-Null
    $machine = $reader.ReadUInt16()

    switch ($machine) {
      0x8664 { return 'x64' }
      0xaa64 { return 'arm64' }
      0x014c { return 'x86' }
      default { return ('0x{0:x4}' -f $machine) }
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Assert-X64Pe {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label is missing: $Path"
  }

  $machine = Get-PeMachineName -Path $Path
  Write-Host "$Label : $machine : $Path"
  if ($machine -ne 'x64') {
    throw "$Label must be x64, got $machine at $Path"
  }
}

$resolvedZip = (Resolve-Path -LiteralPath $ZipPath).Path
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("codex-win-x64-verify-" + [guid]::NewGuid().ToString('N'))

try {
  Expand-Archive -LiteralPath $resolvedZip -DestinationPath $tempDir -Force

  $codexExe = Get-ChildItem -LiteralPath $tempDir -Filter 'Codex.exe' -File -Recurse |
    Sort-Object { $_.FullName.Length } |
    Select-Object -First 1
  if (-not $codexExe) {
    throw "Codex.exe was not found in $resolvedZip"
  }

  Assert-X64Pe -Path $codexExe.FullName -Label 'Codex.exe'
  $appDir = $codexExe.DirectoryName

  $cuaNode = Join-Path $appDir 'resources\cua_node\bin\node.exe'
  if (Test-Path -LiteralPath $cuaNode) {
    Assert-X64Pe -Path $cuaNode -Label 'CUA node.exe'
  }

  $chromeHost = Join-Path $appDir 'resources\plugins\openai-bundled\plugins\chrome\extension-host\windows\x64\extension-host.exe'
  if (Test-Path -LiteralPath $chromeHost) {
    Assert-X64Pe -Path $chromeHost -Label 'Chrome extension host x64'
  }

  $sharpX64 = Join-Path $appDir 'resources\cua_node\bin\node_modules\%40img\sharp-win32-x64\lib\sharp-win32-x64.node'
  $sharpArm64 = Join-Path $appDir 'resources\cua_node\bin\node_modules\%40img\sharp-win32-arm64\lib\sharp-win32-arm64.node'
  if ((Test-Path -LiteralPath $sharpArm64) -and -not (Test-Path -LiteralPath $sharpX64)) {
    throw 'Windows x64 artifact contains ARM64 sharp but no x64 sharp native module.'
  }

  Write-Host "Windows x64 artifact verification passed: $resolvedZip"
}
finally {
  if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
  }
}
