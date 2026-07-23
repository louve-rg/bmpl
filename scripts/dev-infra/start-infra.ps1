# Local dev infrastructure WITHOUT Docker (portable binaries).
# Starts PostgreSQL, Redis, and MinIO from a local infra directory and creates
# the app + test databases and the private documents bucket.
#
# This is the Docker-less equivalent of `docker compose up` (docker-compose.yml
# remains the preferred path where Docker is available). Binaries live outside
# the repo under $InfraDir so data never lands in git.
param(
  [string]$InfraDir = "C:\Smart\GSP\bmpl-infra",
  [string]$DbUser   = "bmpl",
  [string]$DbPass   = "bmpl_dev_password"
)
$ErrorActionPreference = "Stop"
$pgbin  = "$InfraDir\pg\pgsql\bin"
$pgdata = "$InfraDir\pgdata"
$logs   = "$InfraDir\logs"
New-Item -ItemType Directory -Force -Path $logs, "$InfraDir\miniodata", "$InfraDir\redisdata" | Out-Null

# --- PostgreSQL -------------------------------------------------------------
Write-Host "Starting PostgreSQL on :5432 ..."
& "$pgbin\pg_ctl.exe" -D $pgdata -l "$logs\pg.log" -o "-p 5432" -w start
$env:PGPASSWORD = $DbPass
foreach ($db in @("bmpl", "bmpl_test")) {
  $exists = & "$pgbin\psql.exe" -h 127.0.0.1 -p 5432 -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'"
  if ($exists -ne "1") {
    & "$pgbin\createdb.exe" -h 127.0.0.1 -p 5432 -U $DbUser $db
    Write-Host "  created database $db"
  } else {
    Write-Host "  database $db already exists"
  }
}

# --- Redis ------------------------------------------------------------------
if (-not (Get-NetTCPConnection -State Listen -LocalPort 6379 -ErrorAction SilentlyContinue)) {
  Write-Host "Starting Redis on :6379 ..."
  Start-Process -FilePath "$InfraDir\redis\redis-server.exe" `
    -ArgumentList "--port 6379 --save `"`" --appendonly no" `
    -WindowStyle Hidden -RedirectStandardOutput "$logs\redis.log" -RedirectStandardError "$logs\redis.err.log"
} else { Write-Host "Redis already listening on :6379" }

# --- MinIO ------------------------------------------------------------------
if (-not (Get-NetTCPConnection -State Listen -LocalPort 9000 -ErrorAction SilentlyContinue)) {
  Write-Host "Starting MinIO on :9000 (console :9001) ..."
  $env:MINIO_ROOT_USER = $DbUser
  $env:MINIO_ROOT_PASSWORD = $DbPass
  Start-Process -FilePath "$InfraDir\bin\minio.exe" `
    -ArgumentList "server `"$InfraDir\miniodata`" --address :9000 --console-address :9001" `
    -WindowStyle Hidden -RedirectStandardOutput "$logs\minio.log" -RedirectStandardError "$logs\minio.err.log"
  Start-Sleep -Seconds 4
} else { Write-Host "MinIO already listening on :9000" }

# --- Bucket bootstrap -------------------------------------------------------
Write-Host "Ensuring private bucket 'bmpl-documents' ..."
& "$InfraDir\bin\mc.exe" alias set bmpllocal http://127.0.0.1:9000 $DbUser $DbPass | Out-Null
& "$InfraDir\bin\mc.exe" mb --ignore-existing bmpllocal/bmpl-documents | Out-Null
& "$InfraDir\bin\mc.exe" anonymous set none bmpllocal/bmpl-documents | Out-Null
Write-Host "Infrastructure is up."
