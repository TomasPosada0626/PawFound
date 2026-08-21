// Command api starts the PawFound HTTP API.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/health"
)

const defaultPort = "8080"

func main() {
	port := resolvePort(os.Getenv("PORT"))

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// middleware.RealIP is intentionally not used here: it trusts
	// X-Forwarded-For/X-Real-IP unconditionally, which is spoofable unless we
	// know our exact proxy topology (see GHSA-3fxj-6jh8-hvhx). Revisit once the
	// deployment target (e.g. Cloudflare in front of the API) is decided.
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Get("/health", health.Handler)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("pawfound-api listening on :%s", port) //nolint:gosec // port is validated numeric by resolvePort, cannot contain control characters
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// resolvePort validates PORT so an untrusted/malformed env value never flows
// unchecked into logs or the listen address.
func resolvePort(raw string) string {
	if raw == "" {
		return defaultPort
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 65535 {
		log.Printf("PORT=%q is not a valid port; using %s", raw, defaultPort) //nolint:gosec // %q escapes control characters, raw cannot forge log lines
		return defaultPort
	}
	return strconv.Itoa(n)
}
