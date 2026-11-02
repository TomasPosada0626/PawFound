package app

import (
	"context"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

// Impact son las cifras de "Nuestro impacto" de una ciudad, con todos sus casos (también los
// cerrados). Con pocos casos los porcentajes engañan: Enough queda en false y no se envían cifras.
type Impact struct {
	Enough                  bool `json:"enough"`
	Reunited                int  `json:"reunited"`
	ReportsThisMonth        int  `json:"reportsThisMonth"`
	ActiveCases             int  `json:"activeCases"`
	ReunitedWithin14DaysPct int  `json:"reunitedWithin14DaysPct"`
}

// colombia: el mes de "Reportes este mes" empieza a medianoche de Colombia (UTC-5, sin horario de verano).
var colombia = time.FixedZone("COT", -5*60*60)

// CityImpact calcula las cifras de una ciudad. Los casos retirados por moderación o eliminados no cuentan.
func (a *App) CityImpact(ctx context.Context, city string) (Impact, error) {
	key := domain.CityKey(city)
	if key == "" {
		return Impact{}, nil
	}
	now := a.now()
	local := now.In(colombia)
	monthStart := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, colombia)
	var total, eligible, fast int
	var out Impact
	// Igual que impactStats en la app: para el porcentaje cuentan las perdidas ya reencontradas o
	// con al menos 14 días, para no castigar los casos que todavía están dentro de la ventana.
	err := a.DB.QueryRow(ctx, `SELECT
			count(*),
			count(*) FILTER (WHERE state = 'reunited'),
			count(*) FILTER (WHERE created_at >= $2),
			count(*) FILTER (WHERE state = 'active'),
			count(*) FILTER (WHERE kind = 'lost' AND (state = 'reunited' OR created_at <= $3)),
			count(*) FILTER (WHERE kind = 'lost' AND (state = 'reunited' OR created_at <= $3)
				AND reunited_at IS NOT NULL AND reunited_at <= created_at + interval '14 days')
		FROM pets WHERE city_key = $1 AND NOT moderation_removed AND withdrawn_at IS NULL`,
		key, monthStart, now.Add(-14*24*time.Hour)).
		Scan(&total, &out.Reunited, &out.ReportsThisMonth, &out.ActiveCases, &eligible, &fast)
	if err != nil || total < domain.MinCasesForStats {
		return Impact{}, err
	}
	out.Enough = true
	if eligible > 0 {
		out.ReunitedWithin14DaysPct = (fast*100 + eligible/2) / eligible
	}
	return out, nil
}
