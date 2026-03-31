CREATE INDEX IF NOT EXISTS zones_backend_name_name_idx
    ON zones (backend_name, name);

CREATE INDEX IF NOT EXISTS audit_events_created_at_id_idx
    ON audit_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS audit_events_actor_created_at_id_idx
    ON audit_events (actor, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS audit_events_zone_name_created_at_id_idx
    ON audit_events (zone_name, created_at DESC, id DESC)
    WHERE zone_name IS NOT NULL;
