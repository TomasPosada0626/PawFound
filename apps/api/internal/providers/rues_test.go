package providers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRUESLookup(t *testing.T) {
	var gotNIT, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotNIT, gotToken = r.URL.Query().Get("nit"), r.Header.Get("X-App-Token")
		w.Header().Set("Content-Type", "application/json")
		switch gotNIT {
		case "900078738":
			// Dos matrículas: se prefiere la activa.
			_, _ = w.Write([]byte(`[{"razon_social":"FUNDACION VIEJA","estado_matricula":"CANCELADA","organizacion_juridica":"FUNDACIONES"},
				{"razon_social":" FUNDACION BIENESTAR ANIMAL ","digito_verificacion":"7","estado_matricula":"ACTIVA","organizacion_juridica":"FUNDACIONES","camara_comercio":"MEDELLIN PARA ANTIOQUIA"}]`))
		case "1":
			w.WriteHeader(http.StatusTooManyRequests)
		case "2":
			_, _ = w.Write([]byte(`no es json`))
		default:
			_, _ = w.Write([]byte(`[]`))
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	r := RUES{URL: srv.URL, AppToken: "tok"}

	rec, err := r.LookupNIT(ctx, "900078738")
	if err != nil || rec == nil {
		t.Fatalf("consulta = %+v %v", rec, err)
	}
	if rec.Name != "FUNDACION BIENESTAR ANIMAL" || rec.CheckDigit != "7" || rec.Status != "ACTIVA" || rec.LegalForm != "FUNDACIONES" || rec.Chamber == "" {
		t.Fatalf("registro = %+v", rec)
	}
	if gotNIT != "900078738" || gotToken != "tok" {
		t.Fatalf("petición: nit %q, token %q", gotNIT, gotToken)
	}
	if rec, err := r.LookupNIT(ctx, "999"); err != nil || rec != nil {
		t.Fatalf("sin resultados = %+v %v", rec, err)
	}
	if _, err := r.LookupNIT(ctx, "1"); err == nil {
		t.Fatal("un 429 es un error")
	}
	if _, err := r.LookupNIT(ctx, "2"); err == nil {
		t.Fatal("una respuesta que no es JSON es un error")
	}
	if _, err := (RUES{URL: "http://127.0.0.1:1"}).LookupNIT(ctx, "9"); err == nil {
		t.Fatal("sin conexión es un error")
	}
	if _, err := (RUES{URL: "://mal"}).LookupNIT(ctx, "9"); err == nil {
		t.Fatal("una URL inválida es un error")
	}
}
