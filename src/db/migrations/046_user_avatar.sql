-- ============================================================
--  046 — Avatar del usuario (foto de perfil del organizador)
--  Se sube a Cloudflare R2; acá solo guardamos la URL pública.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
