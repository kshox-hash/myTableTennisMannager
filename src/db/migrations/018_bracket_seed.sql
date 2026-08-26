-- ============================================================
--  018 — Número de semilla en la ronda 1 del cuadro
--  Guarda qué semilla (1, 2, 3...) le tocó a cada jugador en su
--  primer partido de la llave, solo para poder mostrarlo en la UI
--  (semilla 1 vs semilla 8, etc.) — no se usa para nada de lógica de
--  juego, es puramente informativo. NULL en rondas posteriores y en
--  los cupos vacíos (BYE/rama muerta).
-- ============================================================

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS seed1 INT,
  ADD COLUMN IF NOT EXISTS seed2 INT;
