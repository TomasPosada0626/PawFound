package ratelimit

import (
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	l := New(2, time.Minute, func() time.Time { return now })
	for i := 0; i < 2; i++ {
		if ok, _ := l.Allow("ip:1"); !ok {
			t.Fatalf("intento %d bloqueado", i)
		}
	}
	ok, wait := l.Allow("ip:1")
	if ok || wait != time.Minute {
		t.Fatalf("tercer intento: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.Allow("ip:2"); !ok {
		t.Fatal("las claves son independientes")
	}
	now = now.Add(61 * time.Second)
	if ok, _ := l.Allow("ip:1"); !ok {
		t.Fatal("la ventana debe liberarse")
	}
	if _, exists := l.hits["ip:2"]; exists {
		t.Fatal("la limpieza debe borrar claves viejas")
	}
	l.Reset("ip:1")
	if len(l.hits["ip:1"]) != 0 {
		t.Fatal("Reset")
	}
	if New(1, time.Second, nil).now == nil {
		t.Fatal("reloj por defecto")
	}
}
