package app_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

// Si la base de datos se cae, cada operación debe devolver un error (que la API convierte
// en 500 sin detalles) en vez de entrar en pánico o responder datos a medias.
func TestEveryOperationFailsCleanlyWithoutDatabase(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, "postgres://pawfound:x@127.0.0.1:1/nada?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	now := func() time.Time { return time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC) }
	tokens, _ := auth.NewTokens(strings.Repeat("k", 32), time.Hour, now)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := &app.App{
		DB: pool, Tokens: tokens, Codes: auth.NewCodeHasher("x"), SMS: providers.LogSMS{Log: log},
		Media: media.LocalStore{Dir: t.TempDir()}, Log: log, Now: now,
	}
	a.Init()
	ac := app.Actor{ID: "u_1", Name: "Ana Gómez", Verified: true, Role: "moderator", Lang: "es"}
	point := geo.Point{Lat: 6.2447, Lng: -75.5916}
	token, _ := tokens.IssueAccess("u_1")

	calls := map[string]func() error{
		"Register": func() error {
			_, err := a.Register(ctx, app.RegisterInput{Name: "Ana", Email: "a@b.co", Phone: "3001234567", Password: "Patitas2026", AcceptTerms: true, ConfirmAge: true})
			return err
		},
		"Login":        func() error { _, err := a.Login(ctx, "a@b.co", "x"); return err },
		"Refresh":      func() error { _, err := a.Refresh(ctx, "x"); return err },
		"Logout":       func() error { return a.Logout(ctx, "x") },
		"Authenticate": func() error { _, err := a.Authenticate(ctx, token); return err },
		"StartPhone":   func() error { return a.StartPhoneVerification(ctx, ac, "3001234567") },
		"Resend":       func() error { _, err := a.ResendCode(ctx, ac); return err },
		"Verify":       func() error { return a.VerifyCode(ctx, ac, "123456") },
		"ResetConfirm": func() error { return a.ResetPassword(ctx, "t", "Patitas2026") },
		"Me":           func() error { _, err := a.Me(ctx, "u_1"); return err },
		"Profile":      func() error { _, err := a.UpdateProfile(ctx, ac, app.ProfilePatch{Bio: ptr("hola")}); return err },
		"Lang":         func() error { return a.SetLanguage(ctx, ac, "en") },
		"Prefs": func() error {
			_, err := a.UpdateNotificationPrefs(ctx, ac, json.RawMessage(`{}`))
			return err
		},
		"Privacy":   func() error { return a.UpdatePrivacy(ctx, ac, app.PrivacyPrefs{WhoCanMessage: "everyone"}) },
		"AlertZone": func() error { return a.SetAlertZone(ctx, ac, &app.AlertZone{Location: point, Zone: "Laureles"}) },
		"Device":    func() error { return a.RegisterDevice(ctx, ac, "ExponentPushToken[x]", "android") },
		"Unregister": func() error {
			return a.UnregisterDevice(ctx, ac, "x")
		},
		"Export": func() error { _, err := a.ExportData(ctx, ac); return err },
		"Delete": func() error { return a.DeleteAccount(ctx, ac) },
		"Create": func() error {
			_, err := a.CreateReport(ctx, ac, app.ReportInput{
				Kind: "lost", Name: "Max", Species: "dog", Sex: "male", Age: "adult",
				Size: "medium", LastSeenAt: now(), Location: point, Zone: "Laureles",
			})
			return err
		},
		"GetPet": func() error { _, err := a.GetPet(ctx, "", "p"); return err },
		"Nearby": func() error { _, err := a.Nearby(ctx, "", app.NearbyQuery{Center: point}); return err },
		"MyPets": func() error { _, err := a.MyPets(ctx, ac); return err },
		"Sighting": func() error {
			_, err := a.AddSighting(ctx, ac, "p", app.SightingInput{At: now(), Location: point, Zone: "x"})
			return err
		},
		"Helpers":  func() error { _, err := a.HelperCandidates(ctx, ac, "p"); return err },
		"Reunite":  func() error { _, err := a.Reunite(ctx, ac, "p", nil); return err },
		"Share":    func() error { return a.Share(ctx, "u_1", "p") },
		"Withdraw": func() error { return a.Withdraw(ctx, ac, "p") },
		"Matches":  func() error { _, err := a.PossibleMatches(ctx, ac, "p"); return err },
		"Threads":  func() error { _, err := a.Threads(ctx, ac); return err },
		"Thread":   func() error { _, err := a.Thread(ctx, ac, "t"); return err },
		"Join":     func() error { _, err := a.JoinGroup(ctx, ac, "p"); return err },
		"Direct":   func() error { _, err := a.OpenDirect(ctx, ac, "p"); return err },
		"Messages": func() error { _, err := a.Messages(ctx, ac, "t", time.Time{}, 0); return err },
		"Send":     func() error { _, err := a.SendMessage(ctx, ac, "t", app.SendInput{Text: "hola"}); return err },
		"Read":     func() error { return a.MarkThreadRead(ctx, ac, "t") },
		"Mute":     func() error { _, err := a.ToggleMute(ctx, ac, "t"); return err },
		"Notifs":   func() error { _, err := a.Notifications(ctx, ac); return err },
		"ReadOne":  func() error { return a.MarkNotificationRead(ctx, ac, "n") },
		"ReadAll":  func() error { return a.MarkAllNotificationsRead(ctx, ac) },
		"PublicProfile": func() error {
			_, err := a.Profile(ctx, "", "u_2")
			return err
		},
		"Like":       func() error { _, _, err := a.ToggleLike(ctx, ac, "u_2"); return err },
		"ReportUser": func() error { return a.ReportUser(ctx, ac, "u_2", app.UserReportInput{Reason: "spam"}) },
		"ReportPet":  func() error { return a.ReportPet(ctx, ac, "p", app.UserReportInput{Reason: "spam"}) },
		"Owned":      func() error { _, err := a.OwnedPets(ctx, ac); return err },
		"SaveOwned": func() error {
			_, err := a.SaveOwnedPet(ctx, ac, "", app.OwnedPetInput{Name: "Max", Species: "dog", Sex: "male", Age: "adult", Size: "small"})
			return err
		},
		"DeleteOwned":  func() error { return a.DeleteOwnedPet(ctx, ac, "o") },
		"OwnedMatches": func() error { _, _, err := a.OwnedMatches(ctx, ac, "o"); return err },
		"Upload": func() error {
			_, err := a.Upload(ctx, ac, "pet", []byte("x"))
			return err
		},
		"OpenMedia":   func() error { _, _, _, err := a.OpenMedia(ctx, "", "m"); return err },
		"AlertJob":    func() error { _, err := a.RunAlertJob(ctx); return err },
		"Queue":       func() error { _, err := a.ModerationQueue(ctx, "open", 0); return err },
		"Stats":       func() error { _, err := a.ModerationStats(ctx); return err },
		"ModReport":   func() error { _, err := a.ModerationReport(ctx, "r"); return err },
		"Brief":       func() error { _, err := a.UserBrief(ctx, "u"); return err },
		"Find":        func() error { _, err := a.FindUsers(ctx, "ana"); return err },
		"ModLog":      func() error { _, err := a.ModerationLog(ctx, "", 10); return err },
		"Moderate":    func() error { return a.Moderate(ctx, ac, app.ModerationInput{Action: "warn", UserID: "u_2"}) },
		"GrantRole":   func() error { return a.GrantRole(ctx, "a@b.co", "admin") },
		"PwReset":     func() error { return a.RequestPasswordReset(ctx, "a@b.co") },
		"OAuthGoogle": func() error { _, err := a.LoginWithProvider(ctx, "google", "x", "es"); return err },
	}
	for name, call := range calls {
		err := call()
		// Las únicas que no fallan son las que, a propósito, responden igual pase lo que pase.
		if name == "PwReset" {
			if err != nil {
				t.Errorf("%s: el restablecimiento siempre responde igual: %v", name, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("%s: sin base de datos debía fallar", name)
		}
	}
	if e := app.AsError(context.DeadlineExceeded); e.Status != 500 || e.Code != "unknown" || e.Error() != "unknown" {
		t.Fatalf("AsError = %+v", e)
	}
}

func ptr(s string) *string { return &s }
