# Stops the Docker-less local infrastructure (PostgreSQL, Redis, MinIO).
param([string]$InfraDir = "C:\Smart\GSP\bmpl-infra")
$pgbin = "$InfraDir\pg\pgsql\bin"

if (Test-Path "$InfraDir\pgdata") {
  Write-Host "Stopping PostgreSQL ..."
  & "$pgbin\pg_ctl.exe" -D "$InfraDir\pgdata" stop -m fast 2>$null
}
foreach ($name in @("redis-server", "minio")) {
  Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped $name (if running)."
}
Write-Host "Infrastructure stopped."
