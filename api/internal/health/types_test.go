package health

import (
	"encoding/json"
	"testing"
)

func TestDailyHealthUsesCalendarDateContract(t *testing.T) {
	t.Parallel()
	payload, err := json.Marshal(DailyHealth{Date: "2026-09-21"})
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != `{"date":"2026-09-21"}` {
		t.Fatalf("unexpected payload: %s", payload)
	}
}
