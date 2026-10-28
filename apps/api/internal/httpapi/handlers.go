package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
)

func actor(r *http.Request) app.Actor {
	a, _ := actorFrom(r)
	return a
}

// --- Autenticación --------------------------------------------------------------

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in app.RegisterInput
	if !decode(w, r, &in) {
		return
	}
	session, err := s.App.Register(r.Context(), in)
	respond(w, http.StatusCreated, session, err)
}

// login acepta correo o nombre de usuario en "identifier" ("email" por compatibilidad).
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Identifier, Email, Password string }
	if !decode(w, r, &in) {
		return
	}
	id := in.Identifier
	if id == "" {
		id = in.Email
	}
	key := strings.ToLower(strings.TrimSpace(id))
	if ok, _ := s.limits["email"].Allow(key); !ok {
		writeError(w, &app.Error{Code: "rate_limited", Status: http.StatusTooManyRequests})
		return
	}
	session, err := s.App.Login(r.Context(), id, in.Password)
	if err == nil {
		s.limits["email"].Reset(key)
	}
	respond(w, http.StatusOK, session, err)
}

func (s *Server) oauth(w http.ResponseWriter, r *http.Request) {
	var in struct{ Provider, IDToken, Lang string }
	if !decode(w, r, &in) {
		return
	}
	session, err := s.App.LoginWithProvider(r.Context(), in.Provider, in.IDToken, in.Lang)
	respond(w, http.StatusOK, session, err)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct{ RefreshToken string }
	if !decode(w, r, &in) {
		return
	}
	session, err := s.App.Refresh(r.Context(), in.RefreshToken)
	respond(w, http.StatusOK, session, err)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	var in struct{ RefreshToken string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.Logout(r.Context(), in.RefreshToken))
}

func (s *Server) passwordReset(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	if !decode(w, r, &in) {
		return
	}
	if err := s.App.RequestPasswordReset(r.Context(), in.Email); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) passwordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var in struct{ Token, Password string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.ResetPassword(r.Context(), in.Token, in.Password))
}

func (s *Server) resendCode(w http.ResponseWriter, r *http.Request) {
	seconds, err := s.App.ResendCode(r.Context(), actor(r))
	respond(w, http.StatusOK, map[string]int{"resendInSeconds": seconds}, err)
}

func (s *Server) verifyCode(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code string }
	if !decode(w, r, &in) {
		return
	}
	if err := s.App.VerifyCode(r.Context(), actor(r), in.Code); err != nil {
		writeError(w, err)
		return
	}
	me, err := s.App.Me(r.Context(), actor(r).ID)
	respond(w, http.StatusOK, me, err)
}

// --- Cuenta propia -----------------------------------------------------------------

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	me, err := s.App.Me(r.Context(), actor(r).ID)
	respond(w, http.StatusOK, me, err)
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var in app.ProfilePatch
	if !decode(w, r, &in) {
		return
	}
	me, err := s.App.UpdateProfile(r.Context(), actor(r), in)
	respond(w, http.StatusOK, me, err)
}

func (s *Server) setLang(w http.ResponseWriter, r *http.Request) {
	var in struct{ Lang string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.SetLanguage(r.Context(), actor(r), in.Lang))
}

func (s *Server) notificationPrefs(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	prefs, err := s.App.UpdateNotificationPrefs(r.Context(), actor(r), raw)
	respond(w, http.StatusOK, prefs, err)
}

func (s *Server) privacy(w http.ResponseWriter, r *http.Request) {
	var in app.PrivacyPrefs
	if !decode(w, r, &in) {
		return
	}
	respond(w, http.StatusOK, in, s.App.UpdatePrivacy(r.Context(), actor(r), in))
}

func (s *Server) setAlertZone(w http.ResponseWriter, r *http.Request) {
	var in app.AlertZone
	if !decode(w, r, &in) {
		return
	}
	if err := s.App.SetAlertZone(r.Context(), actor(r), &in); err != nil {
		writeError(w, err)
		return
	}
	me, err := s.App.Me(r.Context(), actor(r).ID)
	respond(w, http.StatusOK, me.AlertZone, err)
}

func (s *Server) deleteAlertZone(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.SetAlertZone(r.Context(), actor(r), nil))
}

func (s *Server) registerDevice(w http.ResponseWriter, r *http.Request) {
	var in struct{ Token, Platform string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.RegisterDevice(r.Context(), actor(r), in.Token, in.Platform))
}

func (s *Server) unregisterDevice(w http.ResponseWriter, r *http.Request) {
	var in struct{ Token string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.UnregisterDevice(r.Context(), actor(r), in.Token))
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	data, err := s.App.ExportData(r.Context(), actor(r))
	if err == nil {
		w.Header().Set("Content-Disposition", `attachment; filename="pawfound-mis-datos.json"`)
	}
	respond(w, http.StatusOK, data, err)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.DeleteAccount(r.Context(), actor(r)))
}

func (s *Server) myPets(w http.ResponseWriter, r *http.Request) {
	pets, err := s.App.MyPets(r.Context(), actor(r))
	respond(w, http.StatusOK, pets, err)
}

func (s *Server) ownedPets(w http.ResponseWriter, r *http.Request) {
	pets, err := s.App.OwnedPets(r.Context(), actor(r))
	respond(w, http.StatusOK, pets, err)
}

func (s *Server) saveOwnedPet(w http.ResponseWriter, r *http.Request) {
	var in app.OwnedPetInput
	if !decode(w, r, &in) {
		return
	}
	id := chi.URLParam(r, "id")
	pet, err := s.App.SaveOwnedPet(r.Context(), actor(r), id, in)
	status := http.StatusOK
	if id == "" {
		status = http.StatusCreated
	}
	respond(w, status, pet, err)
}

func (s *Server) deleteOwnedPet(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.DeleteOwnedPet(r.Context(), actor(r), chi.URLParam(r, "id")))
}

func (s *Server) ownedMatches(w http.ResponseWriter, r *http.Request) {
	matches, needsZone, err := s.App.OwnedMatches(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]any{"matches": matches, "needsAlertZone": needsZone}, err)
}

func (s *Server) notifications(w http.ResponseWriter, r *http.Request) {
	list, err := s.App.Notifications(r.Context(), actor(r))
	respond(w, http.StatusOK, list, err)
}

func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.MarkNotificationRead(r.Context(), actor(r), chi.URLParam(r, "id")))
}

func (s *Server) readAllNotifications(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.MarkAllNotificationsRead(r.Context(), actor(r)))
}

// --- Reportes ---------------------------------------------------------------------

func floatParam(r *http.Request, name string) (float64, bool) {
	v, err := strconv.ParseFloat(r.URL.Query().Get(name), 64)
	return v, err == nil
}

func (s *Server) nearby(w http.ResponseWriter, r *http.Request) {
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 {
		writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "center"}})
		return
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	pets, err := s.App.Nearby(r.Context(), viewerID(r), app.NearbyQuery{
		Center: geo.Point{Lat: lat, Lng: lng}, Radius: radius,
		Kind: r.URL.Query().Get("kind"), Species: r.URL.Query().Get("species"), Limit: limit,
	})
	respond(w, http.StatusOK, pets, err)
}

func (s *Server) getPet(w http.ResponseWriter, r *http.Request) {
	pet, err := s.App.GetPet(r.Context(), viewerID(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, pet, err)
}

func (s *Server) share(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.Share(r.Context(), viewerID(r), chi.URLParam(r, "id")))
}

func (s *Server) createReport(w http.ResponseWriter, r *http.Request) {
	var in app.ReportInput
	if !decode(w, r, &in) {
		return
	}
	pet, err := s.App.CreateReport(r.Context(), actor(r), in)
	respond(w, http.StatusCreated, pet, err)
}

func (s *Server) withdraw(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.Withdraw(r.Context(), actor(r), chi.URLParam(r, "id")))
}

func (s *Server) addSighting(w http.ResponseWriter, r *http.Request) {
	var in app.SightingInput
	if !decode(w, r, &in) {
		return
	}
	pet, err := s.App.AddSighting(r.Context(), actor(r), chi.URLParam(r, "id"), in)
	respond(w, http.StatusCreated, pet, err)
}

func (s *Server) reunite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HelperIDs []string `json:"helperIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	pet, err := s.App.Reunite(r.Context(), actor(r), chi.URLParam(r, "id"), in.HelperIDs)
	respond(w, http.StatusOK, pet, err)
}

func (s *Server) reportPet(w http.ResponseWriter, r *http.Request) {
	var in app.UserReportInput
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.ReportPet(r.Context(), actor(r), chi.URLParam(r, "id"), in))
}

func (s *Server) helpers(w http.ResponseWriter, r *http.Request) {
	list, err := s.App.HelperCandidates(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, list, err)
}

func (s *Server) matches(w http.ResponseWriter, r *http.Request) {
	list, err := s.App.PossibleMatches(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, list, err)
}

func (s *Server) joinGroup(w http.ResponseWriter, r *http.Request) {
	id, err := s.App.JoinGroup(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]string{"threadId": id}, err)
}

func (s *Server) openDirect(w http.ResponseWriter, r *http.Request) {
	id, err := s.App.OpenDirect(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]string{"threadId": id}, err)
}

// --- Chats ------------------------------------------------------------------------

func (s *Server) threads(w http.ResponseWriter, r *http.Request) {
	list, err := s.App.Threads(r.Context(), actor(r))
	respond(w, http.StatusOK, list, err)
}

func (s *Server) thread(w http.ResponseWriter, r *http.Request) {
	t, err := s.App.Thread(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, t, err)
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	var before time.Time
	if raw := r.URL.Query().Get("before"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "before"}})
			return
		}
		before = t
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := s.App.Messages(r.Context(), actor(r), chi.URLParam(r, "id"), before, limit)
	respond(w, http.StatusOK, list, err)
}

func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	var in app.SendInput
	if !decode(w, r, &in) {
		return
	}
	m, err := s.App.SendMessage(r.Context(), actor(r), chi.URLParam(r, "id"), in)
	respond(w, http.StatusCreated, m, err)
}

// stopSharingLocation: quien compartió una ubicación la deja de mostrar (se borran las coordenadas).
func (s *Server) stopSharingLocation(w http.ResponseWriter, r *http.Request) {
	m, err := s.App.StopSharingLocation(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, m, err)
}

func (s *Server) readThread(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.MarkThreadRead(r.Context(), actor(r), chi.URLParam(r, "id")))
}

func (s *Server) muteThread(w http.ResponseWriter, r *http.Request) {
	muted, err := s.App.ToggleMute(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]bool{"muted": muted}, err)
}

func (s *Server) archiveThread(w http.ResponseWriter, r *http.Request) {
	archived, err := s.App.ToggleArchive(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]bool{"archived": archived}, err)
}

func (s *Server) closeThread(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.CloseDirect(r.Context(), actor(r), chi.URLParam(r, "id")))
}

func (s *Server) leaveThread(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.LeaveThread(r.Context(), actor(r), chi.URLParam(r, "id")))
}

// --- Comunidad --------------------------------------------------------------------

func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	p, err := s.App.Profile(r.Context(), viewerID(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, p, err)
}

func (s *Server) like(w http.ResponseWriter, r *http.Request) {
	liked, count, err := s.App.ToggleLike(r.Context(), actor(r), chi.URLParam(r, "id"))
	respond(w, http.StatusOK, map[string]any{"liked": liked, "likes": count}, err)
}

func (s *Server) reportUser(w http.ResponseWriter, r *http.Request) {
	var in app.UserReportInput
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.ReportUser(r.Context(), actor(r), chi.URLParam(r, "id"), in))
}

// --- Historias -------------------------------------------------------------------

func (s *Server) stories(w http.ResponseWriter, r *http.Request) {
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 {
		writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "center"}})
		return
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius"))
	list, err := s.App.StoryFeed(r.Context(), viewerID(r), geo.Point{Lat: lat, Lng: lng}, radius)
	respond(w, http.StatusOK, list, err)
}

func (s *Server) addStory(w http.ResponseWriter, r *http.Request) {
	var in app.StoryInput
	if !decode(w, r, &in) {
		return
	}
	item, err := s.App.AddStory(r.Context(), actor(r), chi.URLParam(r, "id"), in)
	respond(w, http.StatusCreated, item, err)
}

func (s *Server) removeStory(w http.ResponseWriter, r *http.Request) {
	respond(w, 0, nil, s.App.RemoveStory(r.Context(), actor(r), chi.URLParam(r, "id")))
}

// --- Veterinarias ------------------------------------------------------------------

func (s *Server) places(w http.ResponseWriter, r *http.Request) {
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 {
		writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "center"}})
		return
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius"))
	list, err := s.App.Places(r.Context(), geo.Point{Lat: lat, Lng: lng}, radius, r.URL.Query().Get("kind"))
	respond(w, http.StatusOK, map[string]any{"places": list, "attribution": app.PlacesAttribution}, err)
}

func (s *Server) reportPlace(w http.ResponseWriter, r *http.Request) {
	var in struct{ Note string }
	if !decode(w, r, &in) {
		return
	}
	respond(w, 0, nil, s.App.ReportPlace(r.Context(), actor(r), chi.URLParam(r, "id"), in.Note))
}

// --- Fotos ------------------------------------------------------------------------

// upload recibe multipart/form-data con "file" y "purpose" (pet, owned, chat).
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+64<<10)
	if err := r.ParseMultipartForm(media.MaxUploadBytes); err != nil {
		writeError(w, &app.Error{Code: "invalid_image", Status: http.StatusRequestEntityTooLarge})
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "file"}})
		return
	}
	defer func() { _ = file.Close() }()
	raw, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil || len(raw) > media.MaxUploadBytes {
		writeError(w, &app.Error{Code: "invalid_image", Status: http.StatusRequestEntityTooLarge})
		return
	}
	out, err := s.App.Upload(r.Context(), actor(r), r.FormValue("purpose"), raw)
	respond(w, http.StatusCreated, out, err)
}

func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	f, contentType, private, err := s.App.OpenMedia(r.Context(), viewerID(r), chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, app.ErrNotFound) || errors.Is(err, media.ErrBadKey) {
			writeError(w, app.ErrNotFound)
			return
		}
		writeError(w, err)
		return
	}
	defer func() { _ = f.Close() }()
	w.Header().Set("Content-Type", contentType)
	if private {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	_, _ = io.Copy(w, f)
}
