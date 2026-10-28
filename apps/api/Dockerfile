# Imagen de la API de PawFound: binario estático sobre distroless (sin shell ni paquetes que
# parchar), corriendo como usuario sin privilegios. Las migraciones van embebidas.
FROM golang:1.26-alpine AS build
WORKDIR /src
ENV GOTOOLCHAIN=auto
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/api"]
