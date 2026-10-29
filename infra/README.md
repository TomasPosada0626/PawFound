# Infraestructura local

## Arrancar dependencias locales

```bash
cp infra/.env.example .env
docker compose -f infra/docker-compose.yml up -d
```

Levanta PostgreSQL + PostGIS en `localhost:5432` y Redis en `localhost:6379`, con
healthchecks para que `docker compose ps` diga cuándo ya están listos.

## Apagar

```bash
docker compose -f infra/docker-compose.yml down       # conserva los datos
docker compose -f infra/docker-compose.yml down -v    # borra también los volúmenes
```

## Entornos

`local` (este Docker Compose), `staging` y `producción` tienen cada uno su propia base de
datos y sus propios secretos — nunca se comparten ni se mezclan entre entornos. En
`staging`/`producción` el backend real será Supabase para el MVP (ver
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)), no este Docker Compose.
