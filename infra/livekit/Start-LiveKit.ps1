[CmdletBinding()]
param(
    [ValidateSet('Docker', 'Native')]
    [string]$Mode = 'Docker',
    [switch]$StartStapp
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$livekitVersion = '1.13.6'
$windowsAmd64Sha256 = '9df299b6c6c32f1be88d3d106a9a63f8f921b424b353cc59f57d6b84532a4475'
$scriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
$envPath = Join-Path $scriptRoot '.env'
$templatePath = Join-Path $scriptRoot 'livekit.template.yaml'
$generatedPath = Join-Path $scriptRoot 'livekit.generated.yaml'
$serverTemplate = Join-Path $repoRoot 'server\stapp.toml'
$serverGenerated = Join-Path $repoRoot 'server\stapp.livekit.toml'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Copie $scriptRoot\.env.example para $envPath e preencha os tres valores."
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $name, $value = $trimmed.Split('=', 2)
    if (-not $value) { throw "Linha invalida no .env: $name" }
    $values[$name.Trim()] = $value.Trim()
}

$hostIp = if ($values.ContainsKey('STAPP_HOST_IP') -and $values['STAPP_HOST_IP']) {
    $values['STAPP_HOST_IP']
} elseif ($values.ContainsKey('STAPP_RADMIN_IP') -and $values['STAPP_RADMIN_IP']) {
    $values['STAPP_RADMIN_IP']
} else {
    $null
}

if (-not $hostIp -or $hostIp -eq 'auto') {
    try {
        $detected = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -First 1
        $hostIp = if ($detected) { $detected.IPAddress } else { '127.0.0.1' }
        Write-Host "IP do host detectado automaticamente: $hostIp"
    } catch {
        $hostIp = '127.0.0.1'
    }
}

$apiKey = $values['STAPP_LIVEKIT_API_KEY']
$apiSecret = $values['STAPP_LIVEKIT_API_SECRET']
$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($hostIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne 'InterNetwork') {
    throw "STAPP_HOST_IP '$hostIp' precisa ser um IPv4 valido."
}
if ($apiKey -notmatch '^[A-Za-z0-9_-]{12,128}$') {
    throw 'STAPP_LIVEKIT_API_KEY precisa ter 12-128 caracteres alfanumericos, _ ou -.'
}
if ($apiSecret.Length -lt 32 -or $apiSecret -match '["\r\n]') {
    throw 'STAPP_LIVEKIT_API_SECRET precisa ter pelo menos 32 caracteres e nao pode conter aspas/quebras de linha.'
}

$livekitConfig = (Get-Content -LiteralPath $templatePath -Raw)
$livekitConfig = $livekitConfig.Replace('__NODE_IP__', $hostIp)
$livekitConfig = $livekitConfig.Replace('__RADMIN_IP__', $hostIp)
$livekitConfig = $livekitConfig.Replace('__API_KEY__', $apiKey)
$livekitConfig = $livekitConfig.Replace('__API_SECRET__', $apiSecret)
[System.IO.File]::WriteAllText($generatedPath, $livekitConfig, $utf8NoBom)

$stappConfig = Get-Content -LiteralPath $serverTemplate -Raw
$stappConfig = $stappConfig -replace '(?m)^backend\s*=\s*"[^"]+"', 'backend     = "livekit"'
$stappConfig = $stappConfig -replace '(?m)^public_url\s*=\s*"[^"]+"', "public_url  = `"ws://${hostIp}:7880`""
[System.IO.File]::WriteAllText($serverGenerated, $stappConfig, $utf8NoBom)

$env:STAPP_LIVEKIT_API_KEY = $apiKey
$env:STAPP_LIVEKIT_API_SECRET = $apiSecret

if ($Mode -eq 'Docker') {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker nao foi encontrado.' }
    & docker compose --file (Join-Path $scriptRoot 'compose.yaml') --env-file $envPath config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'docker compose config recusou a configuracao.' }
    & docker compose --file (Join-Path $scriptRoot 'compose.yaml') --env-file $envPath up --detach
    if ($LASTEXITCODE -ne 0) { throw 'Docker nao conseguiu iniciar o LiveKit.' }
} else {
    $binRoot = Join-Path $scriptRoot 'bin'
    $versionRoot = Join-Path $binRoot $livekitVersion
    $binary = Join-Path $versionRoot 'livekit-server.exe'
    if (-not (Test-Path -LiteralPath $binary)) {
        New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null
        $archive = Join-Path $binRoot "livekit_${livekitVersion}_windows_amd64.zip"
        $uri = "https://github.com/livekit/livekit/releases/download/v${livekitVersion}/livekit_${livekitVersion}_windows_amd64.zip"
        Write-Host "Baixando LiveKit v$livekitVersion do release oficial..."
        Invoke-WebRequest -Uri $uri -OutFile $archive
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $windowsAmd64Sha256) {
            throw "SHA-256 invalido para o binario LiveKit. Esperado $windowsAmd64Sha256; recebido $actual."
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $versionRoot -Force
        if (-not (Test-Path -LiteralPath $binary)) { throw 'O release validado nao continha livekit-server.exe.' }
    }
    $logPath = Join-Path $scriptRoot 'livekit.log'
    $errorPath = Join-Path $scriptRoot 'livekit.error.log'
    $process = Start-Process -FilePath $binary -ArgumentList @('--config', $generatedPath) -WorkingDirectory $scriptRoot `
        -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorPath -PassThru
    Set-Content -LiteralPath (Join-Path $scriptRoot 'livekit.pid') -Value $process.Id -Encoding ascii
}

$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:7880/' -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $healthy) { throw 'LiveKit nao respondeu em 7880 depois de 30 segundos. Veja livekit.error.log ou docker compose logs.' }

Write-Host "LiveKit v$livekitVersion pronto em ws://${hostIp}:7880"
Write-Host 'Firewall: permita TCP 8787, TCP 7880, TCP 7881 e UDP 7882 na sua rede local/VPN. Nenhuma regra foi criada automaticamente.'

if ($StartStapp) {
    $serverLog = Join-Path $scriptRoot 'stapp-server.log'
    $serverError = Join-Path $scriptRoot 'stapp-server.error.log'
    $server = Start-Process -FilePath 'cargo' -ArgumentList @('run', '--manifest-path', (Join-Path $repoRoot 'server\Cargo.toml'), '--', '--config', $serverGenerated, 'serve') `
        -WorkingDirectory (Join-Path $repoRoot 'server') -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverError -PassThru
    Set-Content -LiteralPath (Join-Path $scriptRoot 'stapp-server.pid') -Value $server.Id -Encoding ascii
    Write-Host "Servidor Stapp iniciado com LiveKit (PID $($server.Id))."
} else {
    Write-Host "Para subir o Stapp junto: .\Start-LiveKit.ps1 -Mode $Mode -StartStapp"
}
