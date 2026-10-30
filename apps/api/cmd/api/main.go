// Command api starts the PawFound HTTP API.
//
//	api                          sirve la API, el panel de moderación y las tareas periódicas
//	api migrate                  aplica las migraciones pendientes y termina
//	api grant-role <correo> <rol> da el rol user, moderator o admin (acceso al panel)
//	api import-places            importa las veterinarias del Valle de Aburrá (OpenStreetMap)
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/admin"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/config"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/db"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/httpapi"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/jobs"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

const defaultPort = "8080"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	if err := run(os.Args[1:], logger); err != nil {
		logger.Error("pawfound-api", "err", err)
		os.Exit(1)
	}
}

func run(args []string, logger *slog.Logger) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("configuración inválida:\n%w", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	command := "serve"
	if len(args) > 0 {
		command = args[0]
	}
	switch command {
	case "migrate":
		n, err := db.Migrate(ctx, pool)
		logger.Info("migraciones aplicadas", "count", n)
		return err
	case "grant-role":
		if len(args) != 3 {
			return errors.New("uso: api grant-role <correo> <user|moderator|admin>")
		}
		a := &app.App{DB: pool, Log: logger}
		a.Init()
		if err := a.GrantRole(ctx, args[1], args[2]); err != nil {
			return err
		}
		logger.Info("rol actualizado", "role", args[2])
		return nil
	case "import-places":
		a := &app.App{DB: pool, Log: logger}
		a.Init()
		n, err := a.ImportPlaces(ctx, os.Getenv("OVERPASS_URL"), app.ValleDeAburra, nil)
		logger.Info("lugares importados de OpenStreetMap", "count", n)
		return err
	case "serve":
	default:
		return fmt.Errorf("comando desconocido %q", command)
	}

	if cfg.MigrateOnStart {
		if n, err := db.Migrate(ctx, pool); err != nil {
			return err
		} else if n > 0 {
			logger.Info("migraciones aplicadas", "count", n)
		}
	}
	tokens, err := auth.NewTokens(cfg.JWTSecret, cfg.AccessTTL, nil)
	if err != nil {
		return err
	}
	a := &app.App{
		DB: pool, Tokens: tokens, Codes: auth.NewCodeHasher(cfg.JWTSecret), Log: logger,
		Google: auth.GoogleProvider(cfg.GoogleClients), Apple: auth.AppleProvider(cfg.AppleClients),
		APIBaseURL: cfg.APIBaseURL, WebBaseURL: cfg.WebBaseURL, AdminEmails: cfg.AdminEmails,
		FixedCode: cfg.FixedCode,
	}
	// Fotos: Cloudflare R2 si está configurado; si no, el disco local (solo para desarrollo).
	if cfg.R2.Enabled() {
		store := media.R2(cfg.R2.AccountID, cfg.R2.Bucket, cfg.R2.AccessKey, cfg.R2.SecretKey)
		a.Media = store
		// Al arrancar se prueba que R2 acepte fotos; si no, el log dice por qué (clave, permiso
		// o bucket) sin mostrar secretos.
		go func() {
			checkCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			if err := store.Check(checkCtx); err != nil {
				logger.Error("Cloudflare R2 no acepta fotos", "endpoint", store.Endpoint, "bucket", store.Bucket, "err", err)
				return
			}
			logger.Info("Cloudflare R2 acepta fotos", "bucket", store.Bucket)
		}()
	} else {
		a.Media = media.LocalStore{Dir: cfg.MediaDir}
	}
	switch {
	case cfg.BrevoAPIKey != "":
		// API web de Brevo (HTTPS): funciona aunque el hosting bloquee SMTP, como Render gratis.
		web := strings.TrimRight(cfg.WebBaseURL, "/")
		a.Mailer = providers.BrevoMailer{APIKey: cfg.BrevoAPIKey, From: cfg.SMTP.From, Brand: providers.EmailBrand{
			WebURL: web, LogoURL: web + "/email/logo.png", Contact: cfg.SMTP.From,
		}}
	case cfg.SMTP.Host != "":
		a.Mailer = providers.SMTPMailer{Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password, From: cfg.SMTP.From}
	case cfg.Development():
		a.Mailer = providers.LogMailer{Log: logger}
	}
	switch cfg.PushProvider {
	case "expo":
		a.Push = providers.ExpoPush{AccessToken: cfg.ExpoToken}
	case "log":
		a.Push = providers.LogPush{Log: logger}
	default:
		a.Push = noPush{}
	}
	a.Init()

	panel := &admin.Panel{App: a, Log: logger, SecureCookie: !cfg.Development()}
	server := &httpapi.Server{App: a, Log: logger, ClientIPHeader: cfg.ClientIPHeader, Admin: panel.Handler()}
	// Veterinarias: si la tabla está vacía se cargan solas. Las tareas periódicas lo hacen en su
	// primera ronda (al arrancar) y lo reintentan cada ronda hasta lograrlo; sin tareas, se lanza
	// aquí una vez. Para actualizarlas después: api import-places.
	if !cfg.JobsEnabled {
		go func() {
			if _, _, err := a.EnsurePlaces(ctx, os.Getenv("OVERPASS_URL")); err != nil {
				logger.Error("no se pudieron cargar las veterinarias", "err", err)
			}
		}()
	}
	if cfg.JobsEnabled {
		go jobs.Run(ctx, a, cfg.JobsInterval, logger)
	}

	srv := &http.Server{
		Addr:              ":" + resolvePort(cfg.Port),
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		// Las fotos tienen hasta 2 minutos para subir (datos móviles); el resto de rutas corta a
		// los 30 s con su propio límite.
		ReadTimeout:    2 * time.Minute,
		WriteTimeout:   2*time.Minute + 10*time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 32 << 10,
	}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	mail, storage := "ninguno", "disco local"
	switch {
	case cfg.BrevoAPIKey != "":
		mail = "brevo (api web)"
	case cfg.SMTP.Host != "":
		mail = "smtp " + cfg.SMTP.Host
	case cfg.Development():
		mail = "log (desarrollo)"
	}
	if cfg.R2.Enabled() {
		storage = "cloudflare r2 (" + cfg.R2.Bucket + ")"
	} else if !cfg.Development() {
		logger.Warn("fotos sin Cloudflare R2: en producción el disco se borra y las subidas fallan; define CLOUDFLARE_R2_*")
	}
	logger.Info("pawfound-api escuchando", "addr", srv.Addr, "env", cfg.Env, "correo", mail, "fotos", storage,
		"push", cfg.PushProvider, "tareas_cada", cfg.JobsInterval.String())
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

// noPush: sin proveedor de push evaluado, las notificaciones quedan solo en la bandeja.
type noPush struct{}

func (noPush) Send(context.Context, []providers.PushMessage) error { return nil }

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
