# Ban TT-SK — Triển khai nhanh (Cloudflare Tunnel) hoặc Render (GitHub)
param(
    [ValidateSet("tunnel", "render", "local")]
    [string]$Mode = "tunnel"
)

$Root = $PSScriptRoot
Set-Location $Root

# Đọc .env nếu có
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $val = $matches[2].Trim().Trim('"')
            [Environment]::SetEnvironmentVariable($name, $val, "Process")
        }
    }
    Write-Host "Da nap bien tu .env"
}

function Get-ServerCmd {
    param([string]$Port)
    # Gunicorn chi chay tren Linux (Render); Windows dung Flask truc tiep
    if ($IsWindows -or $env:OS -match "Windows") {
        return "python server.py"
    }
    return "gunicorn wsgi:app --bind 0.0.0.0:$Port --workers 1 --threads 4 --timeout 120"
}

function Start-App {
    $port = if ($env:PORT) { $env:PORT } else { "8080" }
    $env:PORT = $port
    Write-Host "Khoi dong server port $port ..."
    pip install -q -r requirements.txt
    if ($Mode -eq "local") {
        python server.py
        return
    }
    $env:DEPLOY_MODE = "production"
    $cmd = Get-ServerCmd -Port $port
    Invoke-Expression $cmd
}

function Start-Tunnel {
    $port = if ($env:PORT) { $env:PORT } else { "8080" }
    Write-Host "Tao Cloudflare Tunnel -> localhost:$port"
    cloudflared tunnel --url "http://127.0.0.1:$port"
}

function Setup-Webhook {
    if (-not $env:TELEGRAM_BOT_TOKEN) {
        Write-Host "CANH BAO: Chua co TELEGRAM_BOT_TOKEN trong .env - bo qua webhook"
        return
    }
    Start-Sleep -Seconds 3
    $base = $env:WEBHOOK_BASE_URL
    if (-not $base) {
        Write-Host "CANH BAO: Chua co WEBHOOK_BASE_URL - sau khi tunnel chay, copy URL vao .env"
        return
    }
    python -c "
from telegram_service import setup_webhook
r = setup_webhook()
print(r)
"
}

switch ($Mode) {
    "tunnel" {
        Write-Host @"

=== BAN TT-SK DEPLOY (Cloudflare Tunnel) ===
1. Terminal nay: server
2. Mo terminal moi chay: .\deploy.ps1 -Mode tunnel (chi tunnel) HOAC xem URL ben duoi

"@
        if (-not $env:TELEGRAM_BOT_TOKEN) {
            Write-Host "Tao file .env tu .env.example va dien TELEGRAM_BOT_TOKEN tu @BotFather`n"
        }
        # Server nen chay background; tunnel in foreground shows URL
        $port = if ($env:PORT) { $env:PORT } else { "8080" }
        $env:DEPLOY_MODE = "production"
        $serverCmd = if ($IsWindows -or $env:OS -match "Windows") { "python server.py" } else { "gunicorn wsgi:app --bind 0.0.0.0:$port --workers 1 --threads 4" }
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root'; `$env:DEPLOY_MODE='production'; `$env:PORT='$port'; $serverCmd" -WindowStyle Minimized
        Start-Sleep -Seconds 4
        Write-Host "Dang mo tunnel - COPY URL https://....trycloudflare.com vao WEBHOOK_BASE_URL trong .env"
        Write-Host 'Roi chay: python setup_webhook.py'
        cloudflared tunnel --url "http://127.0.0.1:$port"
    }
    "render" {
        if (-not (gh auth status 2>$null)) {
            Write-Host "Chua dang nhap GitHub. Chay: gh auth login -h github.com -p https -w"
            exit 1
        }
        $repo = "ban-tt-sk-phuoc-hoa"
        gh repo create $repo --public --source . --remote origin --push
        Write-Host @"

Da push GitHub. Tiep theo:
1. Vao https://render.com - New - Blueprint - chon repo $repo
2. Them TELEGRAM_BOT_TOKEN trong Environment
3. Deploy xong - tab Bot nhac - Ket noi Webhook
4. cron-job.org: GET https://YOUR-APP.onrender.com/api/cron/remind?key=CRON_SECRET luc 7h

"@
    }
    "local" {
        python server.py
    }
}
