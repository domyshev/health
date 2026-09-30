package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
)

type Config struct {
	Address               string
	Environment           string
	DatabaseURL           string
	AuthSecret            []byte
	AllowedEmails         map[string]struct{}
	AllowedOrigins        map[string]struct{}
	TrustedProxies        []netip.Prefix
	CookieSecure          bool
	CookieName            string
	SessionLifetime       time.Duration
	CodeLifetime          time.Duration
	EmailMode             string
	ResendAPIKey          string
	EmailFrom             string
	ImporterBaseURL       string
	ImporterControlSecret string
	DevelopmentLoginCode  string
}

func Load() (Config, error) {
	cfg := Config{
		Address:               envOr("HTTP_ADDR", ":8080"),
		Environment:           envOr("APP_ENV", "development"),
		DatabaseURL:           strings.TrimSpace(os.Getenv("HEALTH_HUB_DATABASE_URL")),
		AuthSecret:            []byte(os.Getenv("AUTH_SECRET")),
		AllowedEmails:         make(map[string]struct{}),
		AllowedOrigins:        make(map[string]struct{}),
		CookieSecure:          envBool("COOKIE_SECURE", true),
		SessionLifetime:       30 * 24 * time.Hour,
		CodeLifetime:          10 * time.Minute,
		EmailMode:             strings.ToLower(envOr("EMAIL_MODE", "log")),
		ResendAPIKey:          strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		EmailFrom:             strings.TrimSpace(os.Getenv("EMAIL_FROM")),
		ImporterBaseURL:       strings.TrimRight(strings.TrimSpace(os.Getenv("IMPORTER_BASE_URL")), "/"),
		ImporterControlSecret: strings.TrimSpace(os.Getenv("IMPORTER_CONTROL_SECRET")),
		DevelopmentLoginCode:  strings.TrimSpace(os.Getenv("DEV_LOGIN_CODE")),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("HEALTH_HUB_DATABASE_URL is required")
	}
	if len(cfg.AuthSecret) < 32 {
		return Config{}, errors.New("AUTH_SECRET must contain at least 32 bytes")
	}
	for _, value := range splitCSV(os.Getenv("AUTH_ALLOWED_EMAILS")) {
		email, err := auth.NormalizeEmail(value)
		if err != nil {
			return Config{}, fmt.Errorf("AUTH_ALLOWED_EMAILS contains %q: %w", value, err)
		}
		cfg.AllowedEmails[email] = struct{}{}
	}
	if len(cfg.AllowedEmails) == 0 {
		return Config{}, errors.New("AUTH_ALLOWED_EMAILS must contain at least one email")
	}
	for _, value := range splitCSV(os.Getenv("APP_ORIGINS")) {
		parsed, err := url.Parse(value)
		if err != nil || !validHTTPOrigin(parsed) {
			return Config{}, fmt.Errorf("APP_ORIGINS contains invalid origin %q", value)
		}
		cfg.AllowedOrigins[parsed.Scheme+"://"+parsed.Host] = struct{}{}
	}
	if cfg.ImporterBaseURL != "" {
		parsed, err := url.Parse(cfg.ImporterBaseURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return Config{}, errors.New("IMPORTER_BASE_URL must be an HTTP(S) URL")
		}
	}
	if (cfg.ImporterBaseURL == "") != (cfg.ImporterControlSecret == "") || (cfg.ImporterBaseURL != "" && len(cfg.ImporterControlSecret) < 32) {
		return Config{}, errors.New("importer control URL and a secret of at least 32 bytes must be configured together")
	}
	for _, value := range splitCSV(os.Getenv("TRUSTED_PROXY_CIDRS")) {
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return Config{}, fmt.Errorf("TRUSTED_PROXY_CIDRS contains %q: %w", value, err)
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
	}
	if cfg.CookieSecure {
		cfg.CookieName = "__Host-health_hub_session"
	} else {
		cfg.CookieName = "health_hub_session"
	}
	if cfg.EmailMode != "log" && cfg.EmailMode != "resend" {
		return Config{}, errors.New("EMAIL_MODE must be log or resend")
	}
	if cfg.EmailMode == "log" && cfg.Environment != "development" {
		return Config{}, errors.New("EMAIL_MODE=log is allowed only in development")
	}
	if cfg.EmailMode == "resend" && (cfg.ResendAPIKey == "" || cfg.EmailFrom == "") {
		return Config{}, errors.New("RESEND_API_KEY and EMAIL_FROM are required in resend mode")
	}
	if cfg.Environment == "production" && cfg.DevelopmentLoginCode != "" {
		return Config{}, errors.New("DEV_LOGIN_CODE is forbidden in production")
	}
	if cfg.Environment == "production" {
		if !cfg.CookieSecure {
			return Config{}, errors.New("COOKIE_SECURE must be true in production")
		}
		if len(cfg.AllowedOrigins) == 0 {
			return Config{}, errors.New("APP_ORIGINS is required in production")
		}
		if cfg.ImporterBaseURL == "" {
			return Config{}, errors.New("importer control configuration is required in production")
		}
	}
	return cfg, nil
}

func validHTTPOrigin(parsed *url.URL) bool {
	return (parsed.Scheme == "http" || parsed.Scheme == "https") &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.Path == "" &&
		parsed.RawQuery == "" &&
		parsed.Fragment == ""
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
