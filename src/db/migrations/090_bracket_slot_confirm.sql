-- ============================================================
--  090 — Llave adelantada: la mesa de control confirma cada grupo
--
--  Cuando termina un grupo, sus clasificados entran a sus cupos de la llave
--  "por confirmar": la mesa ve dónde quedan (y la recomendación si alguno
--  queda contra uno de su grupo o club) y los acepta. Mientras tanto ese
--  partido no queda listo para mandarse a una mesa. Solo agrega columnas con
--  valor por defecto FALSE: no cambia datos existentes.
-- ============================================================

ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player1_unconfirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS player2_unconfirmed BOOLEAN NOT NULL DEFAULT FALSE;
