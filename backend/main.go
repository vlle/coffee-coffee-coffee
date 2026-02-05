package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
)

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

type Store struct {
	mu      sync.Mutex
	path    string
	entries []Entry
}

func NewStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), os.ModePerm); err != nil {
		return nil, err
	}

	store := &Store{path: path, entries: []Entry{}}

	if _, err := os.Stat(path); err == nil {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if len(data) > 0 {
			if err := json.Unmarshal(data, &store.entries); err != nil {
				return nil, err
			}
		}
	}

	return store, nil
}

func (s *Store) List() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Entry, len(s.entries))
	copy(out, s.entries)
	return out
}

func (s *Store) Create(input EntryInput) (Entry, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id, err := normalizeID(input.ID)
	if err != nil {
		return Entry{}, err
	}
	if id == "" {
		id = newID()
	}
	entry := Entry{
		ID:         id,
		Beans:      input.Beans,
		BrewMethod: input.BrewMethod,
		Notes:      input.Notes,
		Rating:     input.Rating,
		BrewedAt:   input.BrewedAt,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.entries = append(s.entries, entry)
	if err := s.save(); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) Update(id string, input EntryInput) (Entry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, entry := range s.entries {
		if entry.ID != id {
			continue
		}
		entry.Beans = input.Beans
		entry.BrewMethod = input.BrewMethod
		entry.Notes = input.Notes
		entry.Rating = input.Rating
		entry.BrewedAt = input.BrewedAt
		entry.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		s.entries[i] = entry
		if err := s.save(); err != nil {
			return Entry{}, true, err
		}
		return entry, true, nil
	}
	return Entry{}, false, nil
}

func (s *Store) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, entry := range s.entries {
		if entry.ID != id {
			continue
		}
		s.entries = append(s.entries[:i], s.entries[i+1:]...)
		if err := s.save(); err != nil {
			return true, err
		}
		return true, nil
	}
	return false, nil
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.entries, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", buf)
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

func main() {
	if err := os.MkdirAll("./uploads", os.ModePerm); err != nil {
		log.Fatalf("failed to create uploads directory: %v", err)
	}

	store, err := NewStore("./data/entries.json")
	if err != nil {
		log.Fatalf("failed to init store: %v", err)
	}

	mux := http.NewServeMux()

	// 1. Mock Barcode Lookup
	mux.HandleFunc("/api/lookup", withCors(func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		log.Printf("Looking up barcode: %s", code)

		writeJSON(w, http.StatusOK, map[string]string{
			"product_name": "Ethiopia Yirgacheffe (Mock)",
			"roaster":      "Onyx Coffee Lab",
			"metric":       "340",
		})
	}))

	mux.HandleFunc("/api/entries", withCors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			entries := store.List()
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
			entry, err := store.Create(input)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save entry"})
				return
			}
			writeJSON(w, http.StatusCreated, entry)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	}))

	mux.HandleFunc("/api/entries/", withCors(func(w http.ResponseWriter, r *http.Request) {
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
			entry, found, err := store.Update(id, input)
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
			found, err := store.Delete(id)
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
	}))

	log.Println("Go Backend running on :8080")
	http.ListenAndServe(":8080", mux)
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
