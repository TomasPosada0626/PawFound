# Infraestructura local

## Arrancar

```bash
docker compose -f infra/docker-compose.yml up -d
```

Levanta PostgreSQL 16 con PostGIS en `localhost:5432` (usuario, clave y base `pawfound`), con
healthcheck para que `docker compose ps` diga cuándo está listo. La API aplica las migraciones al
arrancar en `development` (ver [apps/api/README.md](../apps/api/README.md)).

[`.env.example`](.env.example) explica todas las variables de la API. Cópialo a `.env` en la raíz del
repo (ignorado por git) y nunca subas valores reales: el repositorio es público.

## Apagar

```bash
docker compose -f infra/docker-compose.yml down       # conserva los datos
docker compose -f infra/docker-compose.yml down -v    # borra también los volúmenes
```

## Entornos

`local` (este Docker Compose) y `producción` tienen cada uno su propia base de datos y sus propios
secretos, que nunca se comparten ni se mezclan. Producción usa Neon (PostgreSQL 18 con PostGIS), no
este Docker Compose: ver [docs/DESPLIEGUE.md](../docs/DESPLIEGUE.md). Las pruebas de integración usan
otro contenedor PostGIS en el puerto 55432 (ver el README de la API).
