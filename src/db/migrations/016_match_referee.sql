-- ============================================================
--  016 — Árbitro sugerido/asignado por partido
--  No es un rol oficial: es simplemente qué jugador (normalmente
--  del mismo grupo, libre en ese momento) queda anotado como árbitro
--  de ese partido puntual. Editable y puede quedar vacío.
-- ============================================================

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS referee_id UUID REFERENCES users(id_user) ON DELETE SET NULL;

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS referee_id UUID REFERENCES users(id_user) ON DELETE SET NULL;
