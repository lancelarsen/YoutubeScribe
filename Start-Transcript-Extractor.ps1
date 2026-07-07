$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5173
$url = "http://127.0.0.1:$port/"
$logDir = Join-Path $appDir "debug"
$outLog = Join-Path $logDir "shortcut-server.log"
$errLog = Join-Path $logDir "shortcut-server.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-AppPort {
    try {
        $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalAddress -eq "127.0.0.1" -or $_.LocalAddress -eq "0.0.0.0" } |
            Select-Object -First 1
        return $null -ne $connection
    }
    catch {
        return $false
    }
}

if (-not (Test-AppPort)) {
    if (-not (Test-Path (Join-Path $appDir "node_modules"))) {
        Push-Location $appDir
        try {
            npm install
        }
        finally {
            Pop-Location
        }
    }

    Start-Process `
        -FilePath "node" `
        -ArgumentList "server/index.js" `
        -WorkingDirectory $appDir `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -WindowStyle Hidden

    $started = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-AppPort) {
            $started = $true
            break
        }
    }

    if (-not $started) {
        throw "Transcript Extractor did not start on $url. Check $errLog for details."
    }
}

Start-Process $url
