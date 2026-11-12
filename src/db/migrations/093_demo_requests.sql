-- Solicitudes de demo desde la web pública (myttm.cl/demo). Las revisa el
-- súper usuario en su panel; "contacted_at" marca que ya se le respondió.
CREATE TABLE IF NOT EXISTS demo_requests (
  id_demo_request BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  organization    TEXT NOT NULL,
  org_type        TEXT NOT NULL,
  players         TEXT,
  message         TEXT,
  lang            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS demo_requests_created_idx ON demo_requests (created_at DESC);
