CREATE TABLE activity_field_settings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    view_name TEXT NOT NULL CHECK (view_name IN ('list', 'detail')),
    fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
    PRIMARY KEY (user_id, activity_type, view_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_field_settings TO health_hub_api;
