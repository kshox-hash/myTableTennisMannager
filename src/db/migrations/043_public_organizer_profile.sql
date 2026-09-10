-- ============================================================
--  043 — Perfil público de organizador ("Comunidad")
--  El admin decide si su ranking privado ("Mi Ranking") también se
--  muestra en su página pública de organizador — por defecto sigue
--  privado, no cambia nada para quien no lo prenda a propósito.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_ranking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
