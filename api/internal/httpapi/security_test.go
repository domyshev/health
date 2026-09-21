package httpapi

import (
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestClientIPIgnoresForwardedHeaderFromUntrustedPeer(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest("GET", "http://example.test", nil)
	req.RemoteAddr = "198.51.100.10:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.5")

	got := ClientIP(req, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	if got.String() != "198.51.100.10" {
		t.Fatalf("ClientIP = %s", got)
	}
}

func TestClientIPUsesRightmostUntrustedAddressThroughTrustedProxies(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest("GET", "http://example.test", nil)
	req.RemoteAddr = "10.0.0.2:443"
	req.Header.Set("X-Forwarded-For", "203.0.113.5, 10.0.0.1")

	got := ClientIP(req, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	if got.String() != "203.0.113.5" {
		t.Fatalf("ClientIP = %s", got)
	}
}

func TestOriginAllowedRequiresExactConfiguredOrigin(t *testing.T) {
	t.Parallel()
	allowed := map[string]struct{}{"https://health.example": {}}

	if !OriginAllowed("https://health.example", allowed) {
		t.Fatal("configured origin rejected")
	}
	if OriginAllowed("https://evil.example", allowed) || OriginAllowed("https://health.example.evil", allowed) {
		t.Fatal("unconfigured origin accepted")
	}
}
