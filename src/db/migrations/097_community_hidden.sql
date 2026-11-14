-- ============================================================
--  097 — Ocultar organizadores de "Comunidad"
--
--  El súper usuario puede sacar a un admin del directorio público
--  (cuentas de prueba, organizadores que no corresponden). Las cuentas
--  demo (users.demo_expires_at, ver 096) nunca aparecen.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS community_hidden BOOLEAN NOT NULL DEFAULT FALSE;
