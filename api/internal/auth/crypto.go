package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/mail"
	"strings"
)

const (
	codeDigits       = 6
	sessionTokenSize = 32
)

var codeSpace = big.NewInt(1_000_000)

func NormalizeEmail(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	address, err := mail.ParseAddress(normalized)
	if err != nil || address.Address != normalized || address.Name != "" {
		return "", errors.New("invalid email address")
	}
	at := strings.LastIndexByte(normalized, '@')
	if at <= 0 || at == len(normalized)-1 || !strings.Contains(normalized[at+1:], ".") {
		return "", errors.New("invalid email address")
	}
	return normalized, nil
}

func GenerateCode(reader io.Reader) (string, error) {
	if reader == nil {
		reader = rand.Reader
	}
	value, err := rand.Int(reader, codeSpace)
	if err != nil {
		return "", fmt.Errorf("generate login code: %w", err)
	}
	return fmt.Sprintf("%0*d", codeDigits, value.Int64()), nil
}

func CodeDigest(secret []byte, normalizedEmail, code string) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(normalizedEmail))
	_, _ = mac.Write([]byte{':'})
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}

func VerifyCodeDigest(expected, candidate []byte) bool {
	if len(expected) != sha256.Size || len(candidate) != sha256.Size {
		return false
	}
	return subtle.ConstantTimeCompare(expected, candidate) == 1
}

func GenerateSessionToken(reader io.Reader) (string, []byte, error) {
	if reader == nil {
		reader = rand.Reader
	}
	raw := make([]byte, sessionTokenSize)
	if _, err := io.ReadFull(reader, raw); err != nil {
		return "", nil, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, HashSessionToken(token), nil
}

func HashSessionToken(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}
