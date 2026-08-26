-- ============================================================
--  007 — Mesas de juego
-- ============================================================

-- Número de mesas disponibles en el torneo
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS num_tables INTEGER NOT NULL DEFAULT 4;

-- Mesa asignada a cada partido (NULL = sin mesa)
ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS table_number INTEGER;

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS table_number INTEGER;
