<#
.SYNOPSIS
  Prepares the main shop computer's PostgreSQL so every AgriPOS till can use it over the shop network.

.DESCRIPTION
  Creates the agripos database user and database, lets PostgreSQL accept password connections from
  the shop network only, and opens the PostgreSQL port in Windows Firewall for that network.
  Run from an elevated PowerShell on the main shop computer. Use -DryRun to review the changes first.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-shop-server.ps1 -DryRun
#>
param(
  [string]$DatabaseName = 'agripos',
  [string]$AppUser = 'agripos',
  [string]$Network,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

function Step([string]$Message) { Write-Host "-> $Message" -ForegroundColor Cyan }
function Plain([Security.SecureString]$Secure) {
  [Runtime.InteropServices.Marshal]::PtrToStringUni(
    [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secure))
}
function SqlLiteral([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }

if ($DatabaseName -notmatch '^[a-z_][a-z0-9_]{0,62}$' -or $AppUser -notmatch '^[a-z_][a-z0-9_]{0,62}$') {
  throw 'Use lowercase letters, numbers and underscores for the database and user names.'
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $DryRun -and -not $admin) { throw 'Run this script from PowerShell opened as Administrator.' }

$service = Get-CimInstance Win32_Service | Where-Object { $_.Name -like 'postgresql*' } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $service) { throw 'PostgreSQL is not installed on this computer. Install PostgreSQL first.' }
$bin = Split-Path ($service.PathName -replace '^"([^"]+)".*$', '$1')
$data = [regex]::Match($service.PathName, '-D\s+"([^"]+)"').Groups[1].Value
$psql = Join-Path $bin 'psql.exe'
$hba = Join-Path $data 'pg_hba.conf'
if (-not (Test-Path $psql)) { throw "psql was not found in $bin" }
$port = 5432
try {
  $portLine = Select-String -Path (Join-Path $data 'postgresql.conf') -Pattern '^\s*port\s*=\s*(\d+)' |
    Select-Object -First 1
  if ($portLine) { $port = [int]$portLine.Matches[0].Groups[1].Value }
} catch {
  Write-Warning 'Could not read postgresql.conf (run as Administrator); assuming port 5432.'
}

if (-not $Network) {
  $config = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1
  if (-not $config) { throw 'No connected network was found. Pass -Network, for example 192.168.1.0/24.' }
  $address = $config.IPv4Address | Select-Object -First 1
  $prefix = [int]$address.PrefixLength
  $ip = ([Net.IPAddress]::Parse($address.IPAddress)).GetAddressBytes()
  $octets = for ($i = 0; $i -lt 4; $i++) {
    $bits = [Math]::Max(0, [Math]::Min(8, $prefix - 8 * $i))
    $ip[$i] -band ((0xFF -shl (8 - $bits)) -band 0xFF)
  }
  $Network = ($octets -join '.') + "/$prefix"
  $hostAddress = $address.IPAddress
  if ((Get-NetConnectionProfile -InterfaceIndex $config.InterfaceIndex).NetworkCategory -eq 'Public') {
    Write-Warning 'Windows treats this network as Public. Set it to Private in Settings > Network so tills can connect.'
  }
} else {
  $hostAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
}
if ($Network -notmatch '^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$') { throw "Invalid network: $Network" }

Write-Host "PostgreSQL service: $($service.Name) (port $port)"
Write-Host "Data folder:        $data"
Write-Host "Shop network:       $Network"
Write-Host "Database / user:    $DatabaseName / $AppUser"
if ($DryRun) {
  Write-Host "`nDry run. These changes would be made:" -ForegroundColor Yellow
  Step "Create or update PostgreSQL user '$AppUser' and database '$DatabaseName'"
  Step "Set listen_addresses = '*' (PostgreSQL accepts network connections)"
  Step "Add to pg_hba.conf: host $DatabaseName $AppUser $Network scram-sha-256 (backup copy first)"
  Step "Restart service $($service.Name)"
  Step "Allow TCP $port from $Network in Windows Firewall (private and domain networks only)"
  exit 0
}

$superPassword = Plain (Read-Host 'Password of the PostgreSQL "postgres" user' -AsSecureString)
$appPassword = Plain (Read-Host "New password for the '$AppUser' database user (12+ characters)" -AsSecureString)
$confirm = Plain (Read-Host 'Confirm the new password' -AsSecureString)
if ($appPassword.Length -lt 12) { throw 'Use at least 12 characters for the database password.' }
if ($appPassword -ne $confirm) { throw 'The passwords do not match.' }

$env:PGPASSWORD = $superPassword
try {
  function Psql([string]$Database, [string]$Sql) {
    $ErrorActionPreference = 'Continue'
    $result = $Sql | & $psql -X -q -t -A -v ON_ERROR_STOP=1 -h localhost -p $port -U postgres -d $Database 2>&1
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed: $($result -join ' ')" }
    return ($result | Where-Object { $_ -is [string] }) -join ''
  }
  Step "Creating database user '$AppUser'"
  Psql 'postgres' @"
DO `$`$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = $(SqlLiteral $AppUser)) THEN
    ALTER ROLE $AppUser WITH LOGIN PASSWORD $(SqlLiteral $appPassword);
  ELSE
    CREATE ROLE $AppUser WITH LOGIN PASSWORD $(SqlLiteral $appPassword);
  END IF;
END `$`$;
"@ | Out-Null
  $exists = Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname = $(SqlLiteral $DatabaseName);"
  if (-not $exists) {
    Step "Creating database '$DatabaseName'"
    Psql 'postgres' "CREATE DATABASE $DatabaseName OWNER $AppUser;" | Out-Null
  } else {
    Step "Database '$DatabaseName' already exists; making '$AppUser' its owner"
    Psql 'postgres' "ALTER DATABASE $DatabaseName OWNER TO $AppUser;" | Out-Null
  }
  Psql $DatabaseName "ALTER SCHEMA public OWNER TO $AppUser;" | Out-Null
  Step 'Allowing network connections'
  Psql 'postgres' "ALTER SYSTEM SET listen_addresses = '*';" | Out-Null
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$rule = "host    $DatabaseName    $AppUser    $Network    scram-sha-256"
if (-not (Select-String -Path $hba -SimpleMatch $rule -Quiet)) {
  Step 'Allowing the shop network in pg_hba.conf'
  Copy-Item $hba "$hba.agripos-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Add-Content -Path $hba -Value "`n# AgriPOS tills on the shop network`n$rule"
}
Step "Restarting $($service.Name)"
Restart-Service $service.Name

$firewall = 'AgriPOS shop database'
if (-not (Get-NetFirewallRule -DisplayName $firewall -ErrorAction SilentlyContinue)) {
  Step 'Opening the PostgreSQL port for the shop network in Windows Firewall'
  New-NetFirewallRule -DisplayName $firewall -Direction Inbound -Protocol TCP -LocalPort $port `
    -RemoteAddress $Network -Profile Private, Domain -Action Allow | Out-Null
}

$encoded = [Uri]::EscapeDataString($appPassword)
Write-Host "`nDone. In AgriPOS choose Connect your shop and enter:" -ForegroundColor Green
Write-Host "  On this main computer: postgresql://${AppUser}:<password>@localhost:$port/$DatabaseName"
Write-Host "  On every other till:   postgresql://${AppUser}:<password>@${hostAddress}:$port/$DatabaseName"
Write-Host '  (or use this computer''s name instead of its IP address)'
if ($encoded -ne $appPassword) {
  Write-Host '  Your password contains special characters; type it percent-encoded in the URL.' -ForegroundColor Yellow
}
Write-Host 'Give this computer a fixed IP address in your router so the tills can always find it.'
