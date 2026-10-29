package health

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	wantContentType := "application/json"
	if got := rec.Header().Get("Content-Type"); got != wantContentType {
		t.Fatalf("Content-Type = %q, want %q", got, wantContentType)
	}

	wantBody := "{\"status\":\"ok\"}\n"
	if got := rec.Body.String(); got != wantBody {
		t.Fatalf("body = %q, want %q", got, wantBody)
	}
}
