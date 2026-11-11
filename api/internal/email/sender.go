package email

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"time"

	resend "github.com/resend/resend-go/v3"
)

type ResendSender struct {
	client *resend.Client
	from   string
}

func NewResendSender(apiKey, from string) *ResendSender {
	return &ResendSender{client: resend.NewClient(apiKey), from: from}
}

func (s *ResendSender) SendLoginCode(ctx context.Context, recipient, code string, lifetime time.Duration) error {
	minutes := int(lifetime.Round(time.Minute) / time.Minute)
	_, err := s.client.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{recipient},
		Subject: "Your Health login code",
		Text:    fmt.Sprintf("Your Health login code is %s. It expires in %d minutes.", code, minutes),
		Html: fmt.Sprintf(
			"<p>Your Health login code is <strong>%s</strong>.</p><p>It expires in %d minutes.</p>",
			html.EscapeString(code), minutes,
		),
	})
	if err != nil {
		return fmt.Errorf("send login email: %w", err)
	}
	return nil
}

type DevelopmentSender struct {
	logger *slog.Logger
}

func NewDevelopmentSender(logger *slog.Logger) *DevelopmentSender {
	return &DevelopmentSender{logger: logger}
}

func (s *DevelopmentSender) SendLoginCode(_ context.Context, recipient, code string, lifetime time.Duration) error {
	s.logger.Warn("development login code", "email", recipient, "code", code, "expires_in", lifetime.String())
	return nil
}
