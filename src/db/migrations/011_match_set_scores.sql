-- ============================================================
--  011 — Puntaje por set
--  Antes solo se guardaba la cantidad de sets ganados por jugador.
--  Ahora también se guarda el puntaje de cada set jugado (ej: 11-9, 9-11, 11-7).
-- ============================================================

ALTER TABLE group_matches   ADD COLUMN IF NOT EXISTS set_scores JSONB;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS set_scores JSONB;
