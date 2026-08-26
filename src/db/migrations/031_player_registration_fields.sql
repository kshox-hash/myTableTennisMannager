-- ============================================================
--  031 — Campos de registro de jugador que pedía la doc del proyecto
--  (Punto 1: Jugadores) y todavía no existían: fecha de nacimiento,
--  país, documento de identidad y categoría declarada por el jugador.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date  DATE,
  ADD COLUMN IF NOT EXISTS country     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS id_document VARCHAR(50),
  ADD COLUMN IF NOT EXISTS category    VARCHAR(50);
