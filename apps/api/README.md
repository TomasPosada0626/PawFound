# PawFound API

API en Go para PawFound. Ver [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) en la raíz del repo para el diseño completo.

## Requisitos

- Go 1.26+
- Docker (para PostgreSQL/PostGIS y Redis locales — ver [`infra/`](../../infra))

## Comandos

```bash
go run ./cmd/api        # levanta la API en :8080 (o $PORT)
go build ./...          # compila
go vet ./...            # análisis estático básico
go test ./...           # pruebas unitarias
gofmt -l .              # verifica formato (vacío = todo OK)
golangci-lint run       # lint completo (config en .golangci.yml)
```

## Estructura

```text
cmd/api/       # entrypoint (main.go)
internal/      # paquetes privados de la API, uno por dominio (health, auth, publicaciones, ...)
```

`internal/` evita que otros módulos importen paquetes que son detalle de implementación —
solo `cmd/api` los usa.

## Estado

Solo existe el endpoint `GET /health`. El resto de la API se construye issue por issue
según la épica [Plataforma y datos](https://github.com/TomasPosada0626/PawFound/issues/4).
