CREATE TABLE help_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX help_notes_user_created_idx ON help_notes (user_id, created_at DESC, id DESC);
GRANT SELECT, INSERT ON help_notes TO health_hub_api;
