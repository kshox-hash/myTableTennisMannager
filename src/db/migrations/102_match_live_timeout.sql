-- ============================================================
--  102 — Tiempo muerto en vivo
--
--  Mientras un jugador usa su tiempo (1 minuto), quien sigue el partido lo
--  ve en la tarjeta en vivo: { "player": 1|2, "ends_at": "<ISO>" }.
--  NULL cuando no hay tiempo en curso.
-- ============================================================
ALTER TABLE group_matches   ADD COLUMN IF NOT EXISTS live_timeout JSONB;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS live_timeout JSONB;
