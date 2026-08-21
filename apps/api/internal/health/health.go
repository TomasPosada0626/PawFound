// Package health exposes a liveness/readiness endpoint for the API.
package health

import (
	"encoding/json"
	"net/http"
)

type response struct {
	Status string `json:"status"`
}

// Handler responds 200 with {"status":"ok"} when the process is up.
// It does not check downstream dependencies (database, cache) — that
// belongs to a separate readiness check once those clients exist.
func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response{Status: "ok"})
}
