# Docker-less local infrastructure

Starts PostgreSQL, Redis, and MinIO from **portable binaries** when Docker is not
available. `../../docker-compose.yml` is the preferred path where Docker exists;
these scripts are the equivalent for machines without a container runtime.

## One-time: fetch binaries

Download into an infra directory outside the repo (so data never lands in git),
e.g. `C:\Smart\GSP\bmpl-infra`:

- PostgreSQL 16 (binaries zip) → `pg\pgsql\bin\*`
- MinIO server → `bin\minio.exe`, MinIO client → `bin\mc.exe`
- Redis (Windows build) → `redis\redis-server.exe`

Then initialize the Postgres data dir once:

```powershell
& "C:\Smart\GSP\bmpl-infra\pg\pgsql\bin\initdb.exe" `
  -D "C:\Smart\GSP\bmpl-infra\pgdata" -U bmpl `
  --auth-host=scram-sha-256 --auth-local=trust --pwfile=<file-with-password> -E UTF8
```

## Start / stop

```powershell
pwsh scripts/dev-infra/start-infra.ps1   # starts PG:5432, Redis:6379, MinIO:9000/9001
                                         # + creates bmpl and bmpl_test databases
                                         # + creates the private bmpl-documents bucket
pwsh scripts/dev-infra/stop-infra.ps1    # stops all three
```

Credentials match `.env` defaults: user `bmpl`, password `bmpl_dev_password`.

> These are development conveniences. Never use these credentials or this
> unmanaged setup for anything beyond a local dev box.
