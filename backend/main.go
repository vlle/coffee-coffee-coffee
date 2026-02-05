package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultPort      = "8080"
	jwtIssuerDefault = "coffee-log"
)

type Config struct {
	DatabaseURL    string
	JWTSecret      string
	JWTIssuer      string
	Port           string
	VapidPublicKey string
	VapidPrivate   string
	VapidSubject   string
}

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type AuthRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type Entry struct {
	ID         string `json:"id"`
	Beans      string `json:"beans"`
	BrewMethod string `json:"brew_method"`
	Notes      string `json:"notes"`
	Rating     int    `json:"rating"`
	BrewedAt   string `json:"brewed_at"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type EntryInput struct {
	ID         string `json:"id,omitempty"`
	Beans      string `json:"beans"`
	BrewMethod string `json:"brew_method"`
	Notes      string `json:"notes"`
	Rating     int    `json:"rating"`
	BrewedAt   string `json:"brewed_at"`
}

type PushKeys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type PushSubscription struct {
	Endpoint       string   `json:"endpoint"`
	ExpirationTime *float64 `json:"expirationTime,omitempty"`
	Keys           PushKeys `json:"keys"`
}

type PushConfig struct {
	PublicKey string `json:"publicKey"`
	Subject   string `json:"subject"`
}

type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

type contextKey string

const userIDKey contextKey = "user_id"

func main() {
	cfg := loadConfig()

	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("failed to reach database: %v", err)
	}

	if err := applyMigrations(db, "./migrations"); err != nil {
		log.Fatalf("failed to apply migrations: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/register", withCors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req AuthRequest
		if err := readJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		user, token, err := registerUser(r.Context(), db, cfg, req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusCreated, AuthResponse{Token: token, User: user})
	}))

	mux.HandleFunc("/api/auth/login", withCors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req AuthRequest
		if err := readJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		user, token, err := loginUser(r.Context(), db, cfg, req)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, AuthResponse{Token: token, User: user})
	}))

	mux.HandleFunc("/api/entries", withCors(withAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		userID := r.Context().Value(userIDKey).(string)

		switch r.Method {
		case http.MethodGet:
			entries, err := listEntries(r.Context(), db, userID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load entries"})
				return
			}
			writeJSON(w, http.StatusOK, entries)
		case http.MethodPost:
			var input EntryInput
			if err := readJSON(w, r, &input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			if err := validateEntry(input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			entry, err := upsertEntry(r.Context(), db, userID, input)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save entry"})
				return
			}
			writeJSON(w, http.StatusCreated, entry)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})))

	mux.HandleFunc("/api/entries/", withCors(withAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		userID := r.Context().Value(userIDKey).(string)
		id := strings.TrimPrefix(r.URL.Path, "/api/entries/")
		if id == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}

		switch r.Method {
		case http.MethodPut:
			var input EntryInput
			if err := readJSON(w, r, &input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			if err := validateEntry(input); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			entry, found, err := updateEntry(r.Context(), db, userID, id, input)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update entry"})
				return
			}
			if !found {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "entry not found"})
				return
			}
			writeJSON(w, http.StatusOK, entry)
		case http.MethodDelete:
			found, err := deleteEntry(r.Context(), db, userID, id)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete entry"})
				return
			}
			if !found {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "entry not found"})
				return
			}
			writeJSON(w, http.StatusNoContent, nil)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})))

	mux.HandleFunc("/api/push/config", withCors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if cfg.VapidPublicKey == "" {
			writeJSON(w, http.StatusOK, PushConfig{})
			return
		}
		writeJSON(w, http.StatusOK, PushConfig{PublicKey: cfg.VapidPublicKey, Subject: cfg.VapidSubject})
	}))

	mux.HandleFunc("/api/push/subscribe", withCors(withAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		userID := r.Context().Value(userIDKey).(string)

		var sub PushSubscription
		if err := readJSON(w, r, &sub); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := upsertSubscription(r.Context(), db, userID, sub); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save subscription"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
	})))

	mux.HandleFunc("/api/push/unsubscribe", withCors(withAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		userID := r.Context().Value(userIDKey).(string)
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := readJSON(w, r, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if body.Endpoint == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "endpoint is required"})
			return
		}
		if err := deleteSubscription(r.Context(), db, userID, body.Endpoint); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete subscription"})
			return
		}
		writeJSON(w, http.StatusNoContent, nil)
	})))

	mux.HandleFunc("/api/push/test", withCors(withAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		userID := r.Context().Value(userIDKey).(string)
		if err := sendTestPush(r.Context(), db, cfg, userID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
	})))

	log.Printf("Backend running on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() Config {
	cfg := Config{
		DatabaseURL:    strings.TrimSpace(os.Getenv("DATABASE_URL")),
		JWTSecret:      strings.TrimSpace(os.Getenv("JWT_SECRET")),
		JWTIssuer:      strings.TrimSpace(os.Getenv("JWT_ISSUER")),
		Port:           strings.TrimSpace(os.Getenv("PORT")),
		VapidPublicKey: strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		VapidPrivate:   strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
		VapidSubject:   strings.TrimSpace(os.Getenv("VAPID_SUBJECT")),
	}

	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	if cfg.JWTIssuer == "" {
		cfg.JWTIssuer = jwtIssuerDefault
	}
	if cfg.Port == "" {
		cfg.Port = defaultPort
	}
	return cfg
}

func registerUser(ctx context.Context, db *sql.DB, cfg Config, req AuthRequest) (User, string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if !strings.Contains(email, "@") {
		return User{}, "", errors.New("valid email is required")
	}
	if len(req.Password) < 8 {
		return User{}, "", errors.New("password must be at least 8 characters")
	}

	var exists string
	if err := db.QueryRowContext(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&exists); err == nil {
		return User{}, "", errors.New("email already registered")
	} else if err != sql.ErrNoRows {
		return User{}, "", errors.New("failed to check email")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, "", errors.New("failed to hash password")
	}

	now := time.Now().UTC()
	user := User{
		ID:        newID(),
		Email:     email,
		CreatedAt: now.Format(time.RFC3339),
		UpdatedAt: now.Format(time.RFC3339),
	}

	_, err = db.ExecContext(ctx,
		`INSERT INTO users (id, email, password_hash, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		user.ID, user.Email, string(hash), now, now)
	if err != nil {
		return User{}, "", errors.New("failed to create user")
	}

	token, err := issueToken(cfg, user)
	if err != nil {
		return User{}, "", err
	}

	return user, token, nil
}

func loginUser(ctx context.Context, db *sql.DB, cfg Config, req AuthRequest) (User, string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		return User{}, "", errors.New("email and password are required")
	}

	var user User
	var hash string
	var created time.Time
	var updated time.Time
	row := db.QueryRowContext(ctx,
		"SELECT id, email, password_hash, created_at, updated_at FROM users WHERE email = $1",
		email,
	)
	if err := row.Scan(&user.ID, &user.Email, &hash, &created, &updated); err != nil {
		return User{}, "", errors.New("invalid email or password")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		return User{}, "", errors.New("invalid email or password")
	}
	user.CreatedAt = created.UTC().Format(time.RFC3339)
	user.UpdatedAt = updated.UTC().Format(time.RFC3339)

	token, err := issueToken(cfg, user)
	if err != nil {
		return User{}, "", err
	}

	return user, token, nil
}

func issueToken(cfg Config, user User) (string, error) {
	claims := jwt.MapClaims{
		"sub":   user.ID,
		"email": user.Email,
		"iss":   cfg.JWTIssuer,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	jwtToken := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return jwtToken.SignedString([]byte(cfg.JWTSecret))
}

func withAuth(cfg Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		parts := strings.SplitN(authorization, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing bearer token"})
			return
		}

		token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}

		sub, ok := claims["sub"].(string)
		if !ok || sub == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, sub)
		next(w, r.WithContext(ctx))
	}
}

func listEntries(ctx context.Context, db *sql.DB, userID string) ([]Entry, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, beans, brew_method, notes, rating, brewed_at, created_at, updated_at
		 FROM entries
		 WHERE user_id = $1
		 ORDER BY brewed_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var entry Entry
		var brewed time.Time
		var created time.Time
		var updated time.Time
		if err := rows.Scan(
			&entry.ID,
			&entry.Beans,
			&entry.BrewMethod,
			&entry.Notes,
			&entry.Rating,
			&brewed,
			&created,
			&updated,
		); err != nil {
			return nil, err
		}
		entry.BrewedAt = brewed.UTC().Format(time.RFC3339)
		entry.CreatedAt = created.UTC().Format(time.RFC3339)
		entry.UpdatedAt = updated.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func upsertEntry(ctx context.Context, db *sql.DB, userID string, input EntryInput) (Entry, error) {
	id, err := normalizeID(input.ID)
	if err != nil {
		return Entry{}, err
	}
	if id == "" {
		id = newID()
	}

	brewed, _ := time.Parse(time.RFC3339, input.BrewedAt)
	updated := time.Now().UTC()

	row := db.QueryRowContext(ctx,
		`INSERT INTO entries (id, user_id, beans, brew_method, notes, rating, brewed_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (user_id, id)
		 DO UPDATE SET beans = $3, brew_method = $4, notes = $5, rating = $6, brewed_at = $7, updated_at = $9
		 RETURNING id, beans, brew_method, notes, rating, brewed_at, created_at, updated_at`,
		id, userID, input.Beans, input.BrewMethod, input.Notes, input.Rating, brewed, updated, updated,
	)

	var entry Entry
	var brewedAt time.Time
	var createdAt time.Time
	var updatedAt time.Time
	if err := row.Scan(
		&entry.ID,
		&entry.Beans,
		&entry.BrewMethod,
		&entry.Notes,
		&entry.Rating,
		&brewedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return Entry{}, err
	}
	entry.BrewedAt = brewedAt.UTC().Format(time.RFC3339)
	entry.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	entry.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return entry, nil
}

func updateEntry(ctx context.Context, db *sql.DB, userID string, id string, input EntryInput) (Entry, bool, error) {
	id, err := normalizeID(id)
	if err != nil {
		return Entry{}, false, err
	}
	brewed, _ := time.Parse(time.RFC3339, input.BrewedAt)
	updated := time.Now().UTC()

	res, err := db.ExecContext(ctx,
		`UPDATE entries
		 SET beans = $1, brew_method = $2, notes = $3, rating = $4, brewed_at = $5, updated_at = $6
		 WHERE user_id = $7 AND id = $8`,
		input.Beans, input.BrewMethod, input.Notes, input.Rating, brewed, updated, userID, id,
	)
	if err != nil {
		return Entry{}, false, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return Entry{}, false, nil
	}

	row := db.QueryRowContext(ctx,
		`SELECT created_at FROM entries WHERE user_id = $1 AND id = $2`, userID, id)
	var created time.Time
	if err := row.Scan(&created); err != nil {
		created = updated
	}

	return Entry{
		ID:         id,
		Beans:      input.Beans,
		BrewMethod: input.BrewMethod,
		Notes:      input.Notes,
		Rating:     input.Rating,
		BrewedAt:   brewed.UTC().Format(time.RFC3339),
		CreatedAt:  created.UTC().Format(time.RFC3339),
		UpdatedAt:  updated.UTC().Format(time.RFC3339),
	}, true, nil
}

func deleteEntry(ctx context.Context, db *sql.DB, userID string, id string) (bool, error) {
	id, err := normalizeID(id)
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, "DELETE FROM entries WHERE user_id = $1 AND id = $2", userID, id)
	if err != nil {
		return false, err
	}
	affected, _ := res.RowsAffected()
	return affected > 0, nil
}

func upsertSubscription(ctx context.Context, db *sql.DB, userID string, sub PushSubscription) error {
	if sub.Endpoint == "" || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
		return errors.New("invalid subscription")
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (endpoint)
		 DO UPDATE SET p256dh = $4, auth = $5`,
		newID(), userID, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth, time.Now().UTC(),
	)
	return err
}

func deleteSubscription(ctx context.Context, db *sql.DB, userID string, endpoint string) error {
	_, err := db.ExecContext(ctx,
		"DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
		userID, endpoint,
	)
	return err
}

func sendTestPush(ctx context.Context, db *sql.DB, cfg Config, userID string) error {
	if cfg.VapidPrivate == "" || cfg.VapidPublicKey == "" {
		return errors.New("VAPID keys are not configured")
	}

	rows, err := db.QueryContext(ctx,
		"SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
		userID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	payload := PushPayload{
		Title: "Coffee Log",
		Body:  "Notifications are enabled.",
		URL:   "/",
	}
	body, _ := json.Marshal(payload)

	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			return err
		}
		sub := &webpush.Subscription{
			Endpoint: endpoint,
			Keys: webpush.Keys{
				P256dh: p256dh,
				Auth:   auth,
			},
		}
		_, err := webpush.SendNotification(body, sub, &webpush.Options{
			Subscriber:      cfg.VapidSubject,
			VAPIDPublicKey:  cfg.VapidPublicKey,
			VAPIDPrivateKey: cfg.VapidPrivate,
			TTL:             30,
		})
		if err != nil {
			return err
		}
	}

	return rows.Err()
}

func validateEntry(input EntryInput) error {
	if _, err := normalizeID(input.ID); err != nil {
		return err
	}
	if strings.TrimSpace(input.Beans) == "" {
		return errors.New("beans is required")
	}
	if strings.TrimSpace(input.BrewMethod) == "" {
		return errors.New("brew_method is required")
	}
	if strings.TrimSpace(input.BrewedAt) == "" {
		return errors.New("brewed_at is required")
	}
	if _, err := time.Parse(time.RFC3339, input.BrewedAt); err != nil {
		return errors.New("brewed_at must be RFC3339 (e.g. 2024-05-01T08:30:00Z)")
	}
	if input.Rating < 0 || input.Rating > 5 {
		return errors.New("rating must be between 0 and 5")
	}
	return nil
}

func normalizeID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return "", nil
	}
	for _, r := range id {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			continue
		}
		return "", errors.New("id contains invalid characters")
	}
	return id, nil
}

func newID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", buf)
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload != nil {
		_ = json.NewEncoder(w).Encode(payload)
	}
}

func readJSON(w http.ResponseWriter, r *http.Request, dst interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("multiple JSON values in body")
	}
	return nil
}

func enableCors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
}

func withCors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func applyMigrations(db *sql.DB, dir string) error {
	if err := os.MkdirAll(dir, os.ModePerm); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL)`); err != nil {
		return err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	files := []string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, ".sql") {
			files = append(files, name)
		}
	}
	sort.Strings(files)

	for _, name := range files {
		applied, err := migrationApplied(db, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		content, err := fs.ReadFile(os.DirFS(dir), name)
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(content)); err != nil {
			return fmt.Errorf("migration %s failed: %w", name, err)
		}
		if _, err := db.Exec(`INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)`, name, time.Now().UTC()); err != nil {
			return err
		}
		log.Printf("applied migration %s", name)
	}

	return nil
}

func migrationApplied(db *sql.DB, name string) (bool, error) {
	var filename string
	err := db.QueryRow(`SELECT filename FROM schema_migrations WHERE filename = $1`, name).Scan(&filename)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
