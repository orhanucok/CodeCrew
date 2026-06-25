$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$stage = [IO.Path]::GetFullPath((Join-Path $root ".vsix-stage"))
$output = Join-Path $root "codecrew-0.3.0.vsix"
$zipOutput = Join-Path $root "codecrew-0.3.0.zip"

if (-not $stage.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe staging path."
}

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
if (Test-Path -LiteralPath $zipOutput) {
  Remove-Item -LiteralPath $zipOutput -Force
}

New-Item -ItemType Directory -Path (Join-Path $stage "extension\dist") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "extension\media") -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root "packaging\extension.vsixmanifest") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "packaging\[Content_Types].xml") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination (Join-Path $stage "extension")
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination (Join-Path $stage "extension")
Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination (Join-Path $stage "extension")
Copy-Item -LiteralPath (Join-Path $root "CHANGELOG.md") -Destination (Join-Path $stage "extension")
Copy-Item -LiteralPath (Join-Path $root "media\codecrew.svg") -Destination (Join-Path $stage "extension\media")

$distRoot = [IO.Path]::GetFullPath((Join-Path $root "dist"))
Get-ChildItem -LiteralPath $distRoot -Recurse -File |
  Where-Object { $_.FullName -notmatch "[\\/]test[\\/]" -and $_.Extension -ne ".map" } |
  ForEach-Object {
    $relative = $_.FullName.Substring($distRoot.Length).TrimStart([char[]]"\/")
    $destination = Join-Path (Join-Path $stage "extension\dist") $relative
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination
  }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zipOutput, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($stage.Length).TrimStart([char[]]"\/").Replace("\", "/")
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $_.FullName,
      $entryName,
      [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
  $stream.Dispose()
}
Move-Item -LiteralPath $zipOutput -Destination $output
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Output $output
