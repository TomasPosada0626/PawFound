package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// SetFounder marca la cuenta de quien creó PawFound (comando de administración, sin pantalla).
func (a *App) SetFounder(ctx context.Context, username string) error {
	tag, err := a.DB.Exec(ctx, `UPDATE users SET founder = true WHERE username = $1`, strings.ToLower(strings.TrimSpace(username)))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return newErr(http.StatusNotFound, "not_found", nil)
	}
	return nil
}

// errDryRun deshace la transacción de una simulación.
var errDryRun = errors.New("simulación")

// testDataTables son los datos de uso, en orden para respetar las referencias. No toca cuentas,
// sesiones, celulares, ubicación de alertas, "Mis mascotas", consentimientos ni fotos de perfil.
var testDataTables = []string{
	"moderation_actions", "reports", "notifications", "stories", "messages", "thread_members", "threads",
	"sightings", "pet_helpers", "pet_shares", "pets", "profile_likes", "place_reports",
}

// ResetTestData deja las cuentas como recién creadas: sin reportes, chats, likes ni insignias
// ganadas. Con apply=false solo cuenta lo que borraría. Devuelve el conteo por tabla y las fotos
// a borrar. Es irreversible: sacar un respaldo antes de aplicarlo.
func (a *App) ResetTestData(ctx context.Context, apply bool) (map[string]int64, error) {
	counts := map[string]int64{}
	var keys []string
	err := a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE owned_pets SET last_case_id = NULL`); err != nil {
			return err
		}
		for _, table := range testDataTables {
			tag, err := tx.Exec(ctx, `DELETE FROM `+table)
			if err != nil {
				return err
			}
			counts[table] = tag.RowsAffected()
		}
		rows, _ := tx.Query(ctx, `DELETE FROM media WHERE purpose IN ('pet', 'chat', 'story') RETURNING storage_key`)
		var err error
		keys, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		counts["media"] = int64(len(keys))
		if !apply {
			return errDryRun
		}
		return nil
	})
	if errors.Is(err, errDryRun) {
		return counts, nil
	}
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		if err := a.RemoveStored(ctx, key); err != nil {
			a.Log.Warn("no se pudo borrar una foto del almacenamiento", "err", err)
		}
	}
	return counts, nil
}
