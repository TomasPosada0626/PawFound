package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultRUESURL es el Registro Único Empresarial y Social (Confecámaras) publicado como datos
// abiertos en datos.gov.co: personas naturales, personas jurídicas y entidades sin ánimo de lucro.
// Licencia CC BY-SA 4.0: hay que citar la fuente.
const DefaultRUESURL = "https://www.datos.gov.co/resource/c82u-588k.json"

// CompanyRecord es lo que el RUES dice de un NIT.
type CompanyRecord struct {
	Name       string // razón social
	CheckDigit string // dígito de verificación
	Status     string // estado de la matrícula: ACTIVA, CANCELADA…
	LegalForm  string // organización jurídica: FUNDACIONES, SOCIEDAD ANONIMA…
	Chamber    string // cámara de comercio
}

// CompanyRegistry consulta un NIT sin dígito de verificación. Devuelve nil, nil si no aparece.
type CompanyRegistry interface {
	LookupNIT(ctx context.Context, nit string) (*CompanyRecord, error)
}

// RUES consulta el registro de datos.gov.co. AppToken es opcional: sube el límite de consultas.
type RUES struct {
	URL      string
	AppToken string
	Client   *http.Client
}

type ruesRow struct {
	RazonSocial  string `json:"razon_social"`
	DV           string `json:"digito_verificacion"`
	Estado       string `json:"estado_matricula"`
	Organizacion string `json:"organizacion_juridica"`
	Camara       string `json:"camara_comercio"`
}

// LookupNIT busca el NIT. Si tiene varias matrículas (una cancelada y otra activa), prefiere la activa.
func (r RUES) LookupNIT(ctx context.Context, nit string) (*CompanyRecord, error) {
	base := r.URL
	if base == "" {
		base = DefaultRUESURL
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("nit", nit)
	q.Set("$limit", "10")
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if r.AppToken != "" {
		req.Header.Set("X-App-Token", r.AppToken)
	}
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("RUES respondió %d", res.StatusCode)
	}
	var rows []ruesRow
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&rows); err != nil {
		return nil, fmt.Errorf("RUES: respuesta inválida: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	pick := rows[0]
	for _, row := range rows {
		if strings.EqualFold(strings.TrimSpace(row.Estado), "ACTIVA") {
			pick = row
			break
		}
	}
	return &CompanyRecord{
		Name:       strings.TrimSpace(pick.RazonSocial),
		CheckDigit: strings.TrimSpace(pick.DV),
		Status:     strings.TrimSpace(pick.Estado),
		LegalForm:  strings.TrimSpace(pick.Organizacion),
		Chamber:    strings.TrimSpace(pick.Camara),
	}, nil
}
