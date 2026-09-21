package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

func TestNormalizeEmail(t *testing.T) {
	t.Parallel()

	got, err := NormalizeEmail("  User.Name+tag@Example.COM ")
	if err != nil {
		t.Fatalf("NormalizeEmail returned error: %v", err)
	}
	if got != "user.name+tag@example.com" {
		t.Fatalf("NormalizeEmail = %q", got)
	}
}

func TestNormalizeEmailRejectsDisplayNameAndInvalidAddress(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"Name <user@example.com>", "not-an-email", "user@localhost"} {
		if _, err := NormalizeEmail(value); err == nil {
			t.Fatalf("NormalizeEmail(%q) succeeded", value)
		}
	}
}

func TestGenerateCodeProducesSixDigits(t *testing.T) {
	t.Parallel()

	for range 100 {
		code, err := GenerateCode(rand.Reader)
		if err != nil {
			t.Fatalf("GenerateCode returned error: %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("code length = %d", len(code))
		}
		for _, char := range code {
			if char < '0' || char > '9' {
				t.Fatalf("code contains non-digit: %q", code)
			}
		}
	}
}

func TestCodeDigestBindsEmailAndUsesConstantTimeVerification(t *testing.T) {
	t.Parallel()

	secret := []byte("a sufficiently long test secret")
	digest := CodeDigest(secret, "user@example.com", "123456")

	if !VerifyCodeDigest(digest, CodeDigest(secret, "user@example.com", "123456")) {
		t.Fatal("matching digest did not verify")
	}
	if VerifyCodeDigest(digest, CodeDigest(secret, "other@example.com", "123456")) {
		t.Fatal("digest verified for another email")
	}
	if VerifyCodeDigest(digest, CodeDigest(secret, "user@example.com", "654321")) {
		t.Fatal("digest verified for another code")
	}
}

func TestGenerateSessionTokenUsesThirtyTwoRandomBytes(t *testing.T) {
	t.Parallel()

	raw := bytes.Repeat([]byte{0x42}, 32)
	token, hash, err := GenerateSessionToken(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("GenerateSessionToken returned error: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("token is not base64url: %v", err)
	}
	if !bytes.Equal(decoded, raw) {
		t.Fatalf("decoded token differs: %x", decoded)
	}
	if len(hash) != 32 || strings.Contains(string(hash), token) {
		t.Fatal("session hash is invalid")
	}
	if got := HashSessionToken(token); !bytes.Equal(got, hash) {
		t.Fatal("HashSessionToken does not match generated hash")
	}
}
