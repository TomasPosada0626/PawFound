package httpapi

import (
	"context"
	"net/http"
	"testing"
)

func TestUninstalledPhonesStopReceivingPush(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	fan := h.user("Fan Uno", true)
	h.device(ana)
	h.push.uninstall("ExponentPushToken[" + ana.ID + "]")

	// El aviso de la solicitud sale; Expo responde que el celular ya no está y se borra.
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, nil)
	if got := h.pushesTo(ana); len(got) != 1 {
		t.Fatalf("avisos = %d", len(got))
	}
	var devices int
	if err := h.app.DB.QueryRow(context.Background(), `SELECT count(*) FROM devices WHERE user_id = $1`, ana.ID).Scan(&devices); err != nil || devices != 0 {
		t.Fatalf("celulares = %d %v", devices, err)
	}
}
