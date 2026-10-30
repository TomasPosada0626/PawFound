package app

import (
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
)

var shortName = domain.ShortName

// Las formas JSON coinciden con apps/mobile/src/domain/types.ts y packages/contracts/openapi.yaml.

// User es la cuenta propia (solo la ve su dueño).
type User struct {
	ID           string     `json:"id" db:"id"`
	Name         string     `json:"name" db:"name"`
	Username     string     `json:"username" db:"username"`
	Email        string     `json:"email" db:"email"`
	Phone        *string    `json:"phone,omitempty" db:"phone"`
	Verified     bool       `json:"verified" db:"email_verified"`
	Avatar       string     `json:"avatar" db:"avatar"`
	PhotoID      *string    `json:"-" db:"photo_id"`
	PhotoURL     *string    `json:"photoUrl,omitempty" db:"-"`
	Title        string     `json:"title" db:"title"`
	Bio          string     `json:"bio" db:"bio"`
	City         string     `json:"city" db:"city"`
	Neighborhood *string    `json:"neighborhood,omitempty" db:"neighborhood"`
	CreatedAt    time.Time  `json:"createdAt" db:"created_at"`
	MutedUntil   *time.Time `json:"mutedUntil,omitempty" db:"muted_until"`
	Lang         string     `json:"lang" db:"lang"`
	Role         string     `json:"role" db:"role"`
	RatingSum    int        `json:"ratingSum" db:"-"`
	RatingCount  int        `json:"ratingCount" db:"-"`
}

const userCols = `id, name, username, email, phone, email_verified, avatar, photo_id, title, bio, city, neighborhood, created_at, muted_until, lang, role`

// PublicUser es lo que ven las demás personas: nombre corto, nunca correo ni celular.
type PublicUser struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Username     string    `json:"username"`
	Avatar       string    `json:"avatar"`
	PhotoURL     *string   `json:"photoUrl,omitempty"`
	Title        string    `json:"title"`
	Bio          string    `json:"bio"`
	City         string    `json:"city"`
	Neighborhood *string   `json:"neighborhood,omitempty"`
	Verified     bool      `json:"verified"`
	CreatedAt    time.Time `json:"createdAt"`
	Lang         string    `json:"lang"`
}

func publicOf(u User) PublicUser {
	return PublicUser{
		ID: u.ID, Name: shortName(u.Name), Username: u.Username, Avatar: u.Avatar, PhotoURL: u.PhotoURL, Title: u.Title, Bio: u.Bio,
		City: u.City, Neighborhood: u.Neighborhood, Verified: u.Verified, CreatedAt: u.CreatedAt, Lang: u.Lang,
	}
}

// PrivacyPrefs: ningún perfil es oculto; solo se decide quién puede escribir.
type PrivacyPrefs struct {
	WhoCanMessage string `json:"whoCanMessage"`
}

// AlertZone es el punto aproximado que recibe Alertas Ángel.
type AlertZone struct {
	Location geo.Point `json:"location"`
	Zone     string    `json:"zone"`
}

// Allowance dice si la cuenta puede publicar otro reporte hoy.
type Allowance struct {
	Allowed bool       `json:"allowed"`
	RetryAt *time.Time `json:"retryAt,omitempty"`
}

// Me es la cuenta propia con sus preferencias.
type Me struct {
	User              User                     `json:"user"`
	NotificationPrefs domain.NotificationPrefs `json:"notificationPrefs"`
	PrivacyPrefs      PrivacyPrefs             `json:"privacyPrefs"`
	AlertZone         *AlertZone               `json:"alertZone"`
	Allowance         Allowance                `json:"allowance"`
}

// Session es la respuesta de registro, login, OAuth y refresh.
type Session struct {
	AccessToken       string `json:"accessToken"`
	RefreshToken      string `json:"refreshToken"`
	ExpiresIn         int    `json:"expiresIn"`
	Me                Me     `json:"me"`
	NeedsVerification bool   `json:"needsVerification"`
}

// Sighting: la ubicación siempre aproximada. authorId solo lo recibe la familia (para agradecer).
type Sighting struct {
	ID              string    `json:"id"`
	At              time.Time `json:"at"`
	Location        geo.Point `json:"location"`
	Zone            string    `json:"zone"`
	Note            *string   `json:"note,omitempty"`
	AuthorID        string    `json:"authorId,omitempty"`
	AuthorShortName string    `json:"authorShortName"`
}

// UserSummary acompaña reportes y chats para mostrar avatar, insignia azul y antigüedad.
type UserSummary struct {
	ID        string    `json:"id"`
	ShortName string    `json:"shortName"`
	Avatar    string    `json:"avatar"`
	PhotoURL  *string   `json:"photoUrl,omitempty"`
	Verified  bool      `json:"verified"`
	CreatedAt time.Time `json:"createdAt"`
	Lang      string    `json:"lang"`
}

// Pet es un reporte (caso) tal como lo ve la app.
type Pet struct {
	ID                string       `json:"id"`
	Kind              string       `json:"kind"`
	State             string       `json:"state"`
	Name              *string      `json:"name,omitempty"`
	Species           string       `json:"species"`
	Breed             *string      `json:"breed,omitempty"`
	Sex               string       `json:"sex"`
	Age               string       `json:"age"`
	Size              string       `json:"size"`
	Color             *string      `json:"color,omitempty"`
	Collar            *string      `json:"collar,omitempty"`
	Marks             *string      `json:"marks,omitempty"`
	Description       string       `json:"description"`
	Photos            []string     `json:"photos"`
	TraumaticEvent    bool         `json:"traumaticEvent"`
	ShyOrIndoor       bool         `json:"shyOrIndoor"`
	LastSeenAt        time.Time    `json:"lastSeenAt"`
	Location          geo.Point    `json:"location"`
	Zone              string       `json:"zone"`
	FoundSearchRadius *int         `json:"foundSearchRadius,omitempty"`
	Reward            bool         `json:"reward"`
	FoundCondition    *string      `json:"foundCondition,omitempty"`
	FoundCustody      *string      `json:"foundCustody,omitempty"`
	OwnerID           string       `json:"ownerId"`
	OwnerShortName    string       `json:"ownerShortName"`
	Owner             *UserSummary `json:"owner,omitempty"`
	CreatedAt         time.Time    `json:"createdAt"`
	ReunitedAt        *time.Time   `json:"reunitedAt,omitempty"`
	Sightings         []Sighting   `json:"sightings"`
	ShareCount        int          `json:"shareCount"`
	GroupID           string       `json:"groupId"`
	HelperIDs         []string     `json:"helperIds,omitempty"`
	ModerationRemoved bool         `json:"moderationRemoved,omitempty"`
	CurrentRadius     int          `json:"currentRadius"`
}

type petRow struct {
	ID                string     `db:"id"`
	Kind              string     `db:"kind"`
	State             string     `db:"state"`
	Name              *string    `db:"name"`
	Species           string     `db:"species"`
	Breed             *string    `db:"breed"`
	Sex               string     `db:"sex"`
	Age               string     `db:"age"`
	Size              string     `db:"size"`
	Color             *string    `db:"color"`
	Collar            *string    `db:"collar"`
	Marks             *string    `db:"marks"`
	Description       string     `db:"description"`
	Photos            []string   `db:"photos"`
	TraumaticEvent    bool       `db:"traumatic_event"`
	ShyOrIndoor       bool       `db:"shy_or_indoor"`
	LastSeenAt        time.Time  `db:"last_seen_at"`
	Lat               float64    `db:"lat"`
	Lng               float64    `db:"lng"`
	Zone              string     `db:"zone"`
	FoundSearchRadius *int       `db:"found_search_radius"`
	Reward            bool       `db:"reward"`
	FoundCondition    *string    `db:"found_condition"`
	FoundCustody      *string    `db:"found_custody"`
	OwnerID           *string    `db:"owner_id"`
	OwnerShortName    string     `db:"owner_short_name"`
	OwnedPetID        *string    `db:"owned_pet_id"`
	GroupID           string     `db:"group_id"`
	ShareCount        int        `db:"share_count"`
	ModerationRemoved bool       `db:"moderation_removed"`
	CreatedAt         time.Time  `db:"created_at"`
	ReunitedAt        *time.Time `db:"reunited_at"`
}

const petCols = `id, kind, state, name, species, breed, sex, age, size, color, collar, marks, description, photos,
	traumatic_event, shy_or_indoor, last_seen_at, lat, lng, zone, found_search_radius, reward, found_condition,
	found_custody, owner_id, owner_short_name, owned_pet_id, group_id, share_count, moderation_removed, created_at, reunited_at`

func (r petRow) domainCase() domain.Case {
	radius := 0
	if r.FoundSearchRadius != nil {
		radius = *r.FoundSearchRadius
	}
	return domain.Case{
		ID: r.ID, Kind: r.Kind, State: r.State, Species: r.Species, Sex: r.Sex, Size: r.Size,
		Breed: deref(r.Breed), Color: deref(r.Color), TraumaticEvent: r.TraumaticEvent, ShyOrIndoor: r.ShyOrIndoor,
		LastSeenAt: r.LastSeenAt, Location: geo.Point{Lat: r.Lat, Lng: r.Lng}, FoundSearchRadius: radius, OwnerID: deref(r.OwnerID),
	}
}

// OwnedPet es un perfil de "Mis mascotas".
type OwnedPet struct {
	ID          string    `json:"id" db:"id"`
	OwnerID     string    `json:"ownerId" db:"owner_id"`
	Name        string    `json:"name" db:"name"`
	Species     string    `json:"species" db:"species"`
	Breed       *string   `json:"breed,omitempty" db:"breed"`
	Sex         string    `json:"sex" db:"sex"`
	Age         string    `json:"age" db:"age"`
	Size        string    `json:"size" db:"size"`
	Color       *string   `json:"color,omitempty" db:"color"`
	Collar      *string   `json:"collar,omitempty" db:"collar"`
	Marks       *string   `json:"marks,omitempty" db:"marks"`
	Description string    `json:"description" db:"description"`
	Photos      []string  `json:"photos" db:"photos"`
	ShyOrIndoor bool      `json:"shyOrIndoor" db:"shy_or_indoor"`
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	LastCaseID  *string   `json:"lastCaseId,omitempty" db:"last_case_id"`
}

const ownedCols = `id, owner_id, name, species, breed, sex, age, size, color, collar, marks, description, photos, shy_or_indoor, created_at, last_case_id`

// Photo adjunta a un mensaje de chat.
type Photo struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// Message de chat (DM o grupo).
type Message struct {
	ID              string            `json:"id"`
	ThreadID        string            `json:"threadId"`
	AuthorID        string            `json:"authorId"`
	AuthorShortName string            `json:"authorShortName"`
	Text            string            `json:"text"`
	At              time.Time         `json:"at"`
	Kind            string            `json:"kind"`
	Lang            *string           `json:"lang,omitempty"`
	Translations    map[string]string `json:"translations,omitempty"`
	Photo           *Photo            `json:"photo,omitempty"`
	Location        *MessageLocation  `json:"location,omitempty"`
}

// MessageLocation es la ubicación de un mensaje "location": la actual de quien la envió o un
// punto de encuentro (solo en mensajes directos) o una veterinaria. Location queda en nil
// cuando ya no es visible: el servidor borró las coordenadas.
type MessageLocation struct {
	Kind     string     `json:"kind"`
	Location *geo.Point `json:"location,omitempty"`
	Label    string     `json:"label,omitempty"`
	Address  string     `json:"address,omitempty"`
	PlaceID  string     `json:"placeId,omitempty"`
	Hidden   bool       `json:"hidden,omitempty"`
}

// Thread es un chat con lo necesario para la bandeja.
type Thread struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`
	PetID     *string           `json:"petId,omitempty"`
	MemberIDs []string          `json:"memberIds"`
	Members   []UserSummary     `json:"members"`
	ReadAt    map[string]string `json:"readAt"`
	MutedBy   []string          `json:"mutedBy"`
	// Archived: chat cerrado (un mensaje directo que cerró una de las dos personas).
	Archived bool    `json:"archived"`
	ClosedBy *string `json:"closedBy,omitempty"`
	// ArchivedBy: quien lo archivó en su propia lista (cada persona decide).
	ArchivedBy  []string `json:"archivedBy"`
	LastMessage *Message `json:"lastMessage,omitempty"`
	Unread      int      `json:"unread"`
}

// Notification de la bandeja.
type Notification struct {
	ID         string    `json:"id" db:"id"`
	UserID     string    `json:"userId" db:"user_id"`
	Kind       string    `json:"kind" db:"kind"`
	PetID      string    `json:"petId" db:"pet_id"`
	OwnedPetID *string   `json:"ownedPetId,omitempty" db:"owned_pet_id"`
	At         time.Time `json:"at" db:"at"`
	Read       bool      `json:"read" db:"read"`
}
