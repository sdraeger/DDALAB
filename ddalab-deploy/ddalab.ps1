# DDALAB Management Script for Windows PowerShell

param(
    [Parameter(Position=0)]
    [ValidateSet('start', 'stop', 'restart', 'logs', 'status', 'backup')]
    [string]$Command
)

# Set working directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Colors for output
$Host.UI.RawUI.ForegroundColor = "White"

function Write-Success {
    param($Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Error {
    param($Message)
    Write-Host $Message -ForegroundColor Red
}

function Write-Warning {
    param($Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Show-Banner {
    Write-Host ""
    Write-Success "╔══════════════════════════════════════════╗"
    Write-Success "║          DDALAB Management Tool          ║"
    Write-Success "╚══════════════════════════════════════════╝"
    Write-Host ""
}

function Test-Requirements {
    Write-Host "Checking requirements..."
    
    # Check Docker
    try {
        $null = docker --version
    } catch {
        Write-Error "Error: Docker is not installed"
        Write-Host "Please install Docker Desktop from https://docs.docker.com/desktop/windows/install/"
        exit 1
    }
    
    # Check if Docker daemon is running
    try {
        $null = docker info 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }
    } catch {
        Write-Error "Error: Docker daemon is not running"
        Write-Host "Please start Docker Desktop"
        exit 1
    }
    
    Write-Success "✓ All requirements met"
}

function Initialize-Environment {
    if (-not (Test-Path .env)) {
        Write-Warning "No .env file found. Creating from template..."
        Copy-Item .env.example .env
        
        # Generate secure passwords
        Write-Host "Generating secure passwords..."
        
        # Function to generate password
        function Get-RandomPassword {
            -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 25 | ForEach-Object {[char]$_})
        }
        
        # Read content
        $content = Get-Content .env
        
        # Update passwords
        $content = $content -replace 'DB_PASSWORD=.*', "DB_PASSWORD=$(Get-RandomPassword)"
        $content = $content -replace 'MINIO_ROOT_PASSWORD=.*', "MINIO_ROOT_PASSWORD=$(Get-RandomPassword)"
        $content = $content -replace 'JWT_SECRET_KEY=.*', "JWT_SECRET_KEY=$(Get-RandomPassword)"
        $content = $content -replace 'NEXTAUTH_SECRET=.*', "NEXTAUTH_SECRET=$(Get-RandomPassword)"
        
        # Write back
        $content | Set-Content .env
        
        Write-Success "✓ Environment file created with secure passwords"
        Write-Warning "Please review .env and update any settings as needed"
    } else {
        Write-Success "✓ Environment file exists"
    }
}

function Initialize-SSL {
    if (-not ((Test-Path certs/cert.pem) -and (Test-Path certs/key.pem))) {
        Write-Warning "SSL certificates not found. Generating self-signed certificates..."
        
        # Create certs directory
        New-Item -ItemType Directory -Force -Path certs | Out-Null
        
        # Check if OpenSSL is available
        try {
            $null = openssl version
            
            # Generate self-signed certificate
            $subject = "/C=US/ST=State/L=City/O=Organization/CN=localhost"
            & openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
                -keyout certs/key.pem `
                -out certs/cert.pem `
                -subj $subject 2>$null
                
            Write-Success "✓ SSL certificates generated"
        } catch {
            Write-Error "OpenSSL not found. Please install OpenSSL or manually create certificates"
            Write-Host "You can download OpenSSL from: https://slproweb.com/products/Win32OpenSSL.html"
            Write-Host "Or place your certificates as:"
            Write-Host "  - certs/cert.pem"
            Write-Host "  - certs/key.pem"
            exit 1
        }
    } else {
        Write-Success "✓ SSL certificates exist"
    }
}

function Start-Services {
    Write-Host "Starting DDALAB services..."
    
    # Pull latest images
    Write-Host "Pulling latest images..."
    docker compose pull
    
    # Start services
    docker compose up -d
    
    # Wait for services to be ready
    Write-Host "Waiting for services to start..."
    Start-Sleep -Seconds 10
    
    # Check service health
    Write-Host ""
    Write-Host "Service Status:"
    docker compose ps
    
    # Get domain from .env
    $domain = "localhost"
    if (Test-Path .env) {
        $envContent = Get-Content .env | Where-Object { $_ -match "^DOMAIN=" }
        if ($envContent) {
            $domain = $envContent -replace "^DOMAIN=", ""
        }
    }
    
    Write-Host ""
    Write-Success "╔══════════════════════════════════════════════════════════╗"
    Write-Success "║                    DDALAB Started!                       ║"
    Write-Success "╠══════════════════════════════════════════════════════════╣"
    Write-Success "║  Access DDALAB at: https://$domain                      "
    Write-Success "║  MinIO Console at: http://${domain}:9001                 "
    Write-Success "║                                                          ║"
    Write-Success "║  Default credentials:                                    ║"
    Write-Success "║  Email: admin@example.com                                ║"
    Write-Success "║  Password: admin (CHANGE THIS!)                          ║"
    Write-Success "╚══════════════════════════════════════════════════════════╝"
}

function Stop-Services {
    Write-Host "Stopping DDALAB services..."
    docker compose down
    Write-Success "✓ DDALAB stopped"
}

function Show-Logs {
    docker compose logs -f
}

function Show-Status {
    Write-Host "DDALAB Service Status:"
    docker compose ps
}

function Backup-Data {
    Write-Host "Creating backup..."
    if (Test-Path scripts/backup.ps1) {
        & ./scripts/backup.ps1
    } else {
        Write-Warning "Backup script not found. Creating manual backup..."
        
        # Create backup directory
        $backupDir = "backups"
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        
        # Get database credentials from .env
        $dbUser = "ddalab"
        $dbName = "ddalab"
        if (Test-Path .env) {
            $envContent = Get-Content .env
            $userLine = $envContent | Where-Object { $_ -match "^DB_USER=" }
            $nameLine = $envContent | Where-Object { $_ -match "^DB_NAME=" }
            if ($userLine) { $dbUser = $userLine -replace "^DB_USER=", "" }
            if ($nameLine) { $dbName = $nameLine -replace "^DB_NAME=", "" }
        }
        
        # Create backup
        $timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
        $backupFile = "$backupDir/ddalab_backup_$timestamp.sql"
        
        docker compose exec -T postgres pg_dump -U $dbUser $dbName > $backupFile
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "✓ Backup created: $backupFile"
        } else {
            Write-Error "Backup failed"
        }
    }
}

# Main execution
Show-Banner

switch ($Command) {
    'start' {
        Test-Requirements
        Initialize-Environment
        Initialize-SSL
        Start-Services
    }
    'stop' {
        Stop-Services
    }
    'restart' {
        Stop-Services
        Start-Sleep -Seconds 5
        Start-Services
    }
    'logs' {
        Show-Logs
    }
    'status' {
        Show-Status
    }
    'backup' {
        Backup-Data
    }
    default {
        Write-Host "Usage: .\ddalab.ps1 <command>"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  start    - Start DDALAB (sets up environment if needed)"
        Write-Host "  stop     - Stop DDALAB"
        Write-Host "  restart  - Restart DDALAB"
        Write-Host "  logs     - Show service logs (follow mode)"
        Write-Host "  status   - Show service status"
        Write-Host "  backup   - Create database backup"
    }
}