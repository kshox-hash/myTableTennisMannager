-- ============================================================
--  099 — Prueba gratis de 14 días para organizadores
--
--  users.trial_expires_at: cuenta de organizador REAL en prueba (campeonatos
--  públicos, inscripciones de verdad). Al vencer no se borra: queda en solo
--  lectura (ver auth_required_middleware) hasta que el súper usuario la
--  active (NULL) o le dé más días. NULL = cuenta normal.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_trial_expires_idx ON users (trial_expires_at) WHERE trial_expires_at IS NOT NULL;
