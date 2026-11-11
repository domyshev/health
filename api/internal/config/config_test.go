package config

import (
	"net/mail"
	"testing"
)

func TestLoadUsesHealthSenderName(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "01234567890123456789012345678901")
	t.Setenv("AUTH_ALLOWED_EMAILS", "user@example.com")
	t.Setenv("EMAIL_MODE", "resend")
	t.Setenv("RESEND_API_KEY", "resend-key")
	t.Setenv("EMAIL_FROM", "Road Rules Trainer <login@example.com>")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	from, err := mail.ParseAddress(cfg.EmailFrom)
	if err != nil || from.Name != "Health" || from.Address != "login@example.com" {
		t.Fatalf("unexpected sender: %q (%v)", cfg.EmailFrom, err)
	}
}

func TestLoadRequiresProductionSecretsAndParsesLists(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "01234567890123456789012345678901")
	t.Setenv("AUTH_ALLOWED_EMAILS", "User@Example.com, second@example.com")
	t.Setenv("APP_ORIGINS", "https://health.example,https://admin.example")
	t.Setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8,192.168.1.10/32")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("EMAIL_MODE", "log")
	t.Setenv("IMPORTER_BASE_URL", "http://importer:8081")
	t.Setenv("IMPORTER_CONTROL_SECRET", "01234567890123456789012345678901")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.CookieSecure || cfg.DatabaseURL != "postgresql://db/health" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if _, ok := cfg.AllowedEmails["user@example.com"]; !ok {
		t.Fatal("allowed email was not normalized")
	}
	if len(cfg.AllowedOrigins) != 2 || len(cfg.TrustedProxies) != 2 {
		t.Fatalf("lists not parsed: %+v", cfg)
	}
}

func TestLoadRejectsShortAuthSecret(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "short")
	t.Setenv("AUTH_ALLOWED_EMAILS", "user@example.com")
	t.Setenv("EMAIL_MODE", "log")

	if _, err := Load(); err == nil {
		t.Fatal("Load accepted a short AUTH_SECRET")
	}
}

func TestLoadRequiresResendSettingsInResendMode(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "01234567890123456789012345678901")
	t.Setenv("AUTH_ALLOWED_EMAILS", "user@example.com")
	t.Setenv("EMAIL_MODE", "resend")

	if _, err := Load(); err == nil {
		t.Fatal("Load accepted resend mode without credentials")
	}
}

func TestLoadRejectsInsecureProductionCookie(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "01234567890123456789012345678901")
	t.Setenv("AUTH_ALLOWED_EMAILS", "user@example.com")
	t.Setenv("APP_ENV", "production")
	t.Setenv("EMAIL_MODE", "resend")
	t.Setenv("RESEND_API_KEY", "resend-key")
	t.Setenv("EMAIL_FROM", "Health <login@example.com>")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("APP_ORIGINS", "https://health.example")
	t.Setenv("IMPORTER_BASE_URL", "http://importer:8081")
	t.Setenv("IMPORTER_CONTROL_SECRET", "01234567890123456789012345678901")

	if _, err := Load(); err == nil {
		t.Fatal("Load accepted an insecure production cookie")
	}
}

func TestLoadRejectsUnsafeOriginAndShortProductionControlSecret(t *testing.T) {
	t.Setenv("HEALTH_HUB_DATABASE_URL", "postgresql://db/health")
	t.Setenv("AUTH_SECRET", "01234567890123456789012345678901")
	t.Setenv("AUTH_ALLOWED_EMAILS", "user@example.com")
	t.Setenv("APP_ENV", "production")
	t.Setenv("EMAIL_MODE", "resend")
	t.Setenv("RESEND_API_KEY", "resend-key")
	t.Setenv("EMAIL_FROM", "Health <login@example.com>")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("APP_ORIGINS", "javascript://health.example")
	t.Setenv("IMPORTER_BASE_URL", "http://127.0.0.1:8081")
	t.Setenv("IMPORTER_CONTROL_SECRET", "short")

	if _, err := Load(); err == nil {
		t.Fatal("Load accepted an unsafe origin or short control secret")
	}
}
