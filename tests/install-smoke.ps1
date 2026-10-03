param([switch]$ValidateReader)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "release\Jiao_Reader-Setup-$projectVersion.exe"
$testRoot = Join-Path $projectRoot '.test-output'
$installDir = [IO.Path]::GetFullPath((Join-Path $testRoot 'installed-app'))
if (-not $installDir.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test directory' }
if (Test-Path -LiteralPath $installDir) { throw 'Test installation directory already exists' }
$appKey = '00e69db9-e491-57ef-a5ac-d4defa14101e'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $appKey
$keys = @($uninstallKey, ('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $appKey), ('HKCU:\Software\' + $appKey))
foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw 'An existing installed Jiao_Reader was detected; do not replace it during testing.' } }
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Jiao_Reader.lnk'
if (Test-Path -LiteralPath $shortcut) { throw 'An existing shortcut was detected; do not replace it during testing.' }
if (Get-Process -Name Jiao_Reader -ErrorAction SilentlyContinue) { throw 'Jiao_Reader is running; do not interrupt it during installation testing.' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$result = [ordered]@{ installed = $false; appValidated = $false; uninstalled = $false; error = $null }
try {
    $process = Start-Process -FilePath $installer -ArgumentList "/S --currentuser --no-desktop-shortcut /D=$installDir" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exit code: $($process.ExitCode)" }
    if (-not (Test-Path -LiteralPath (Join-Path $installDir 'Jiao_Reader.exe'))) { throw 'Installed executable is missing' }
    $registration = Get-ItemProperty -LiteralPath $uninstallKey
    if ($registration.DisplayVersion -ne $projectVersion) { throw 'Installed version is incorrect' }
    $result.installed = $true
    if ($ValidateReader) {
        $previousExecutable = $env:JIAO_PACKAGED_EXECUTABLE
        try {
            $env:JIAO_PACKAGED_EXECUTABLE = Join-Path $installDir 'Jiao_Reader.exe'
            & node (Join-Path $PSScriptRoot 'reader-smoke.cjs')
            if ($LASTEXITCODE -ne 0) { throw 'Installed reader smoke test failed' }
            $result.appValidated = $true
        } finally { $env:JIAO_PACKAGED_EXECUTABLE = $previousExecutable }
    }
} catch {
    $result.error = $_.Exception.Message
} finally {
    $uninstaller = Join-Path $installDir 'Uninstall Jiao_Reader.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $resolvedUninstaller = (Resolve-Path -LiteralPath $uninstaller).Path
        if (-not $resolvedUninstaller.StartsWith($installDir + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected uninstaller path' }
        $uninstallProcess = Start-Process -FilePath $resolvedUninstaller -ArgumentList "/S _?=$installDir" -WindowStyle Hidden -Wait -PassThru
        $result.uninstalled = $uninstallProcess.ExitCode -eq 0 -and -not (Test-Path -LiteralPath $uninstallKey)
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'install-test.json') -Encoding utf8
}
$result | ConvertTo-Json
if (-not $result.installed -or -not $result.uninstalled -or $result.error -or ($ValidateReader -and -not $result.appValidated)) { exit 1 }
