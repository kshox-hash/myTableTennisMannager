-- ============================================================
--  015 — Mesa donde se jugó realmente cada partido
--  table_number es la asignación EN VIVO (se limpia al liberar la mesa
--  para el siguiente partido). played_table_number queda fijo para
--  siempre como registro histórico de en qué mesa se jugó, aunque la
--  mesa ya se haya liberado y reasignado a otro partido.
-- ============================================================

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS played_table_number INTEGER;

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS played_table_number INTEGER;
