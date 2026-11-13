-- ============================================================
--  096 — Cuentas demo para prospectos
--
--  users.demo_expires_at: cuenta de organizador demo (se borra sola al vencer).
--  users.demo_owner: jugadores ficticios creados para esa demo.
--  tournaments.is_demo: campeonato de ejemplo; nunca suma al ranking general.
--  demo_requests.demo_user_id / demo_sent_at: demo enviada a esa solicitud.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_owner UUID;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE demo_requests
  ADD COLUMN IF NOT EXISTS demo_user_id UUID,
  ADD COLUMN IF NOT EXISTS demo_email TEXT,
  ADD COLUMN IF NOT EXISTS demo_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_demo_expires_idx ON users (demo_expires_at) WHERE demo_expires_at IS NOT NULL;
