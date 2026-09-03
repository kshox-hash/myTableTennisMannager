-- ============================================================
--  039 — Default de sets por partido, a nivel de torneo
-- ============================================================
-- El admin pedía cargar "cantidad de mesas" y "sets por partido" cada vez
-- que confirmaba las cabezas de serie de UNA categoría — cantidad de
-- mesas ya era un dato del torneo entero (tournaments.num_tables, ver
-- 007_tables.sql) así que preguntarlo de nuevo por categoría era
-- redundante y arriesgaba pisar el valor real sin querer. Se mueve al
-- crear el torneo (columna ya existía, esto solo cambia el frontend).
--
-- "Sets por partido" SÍ puede variar de verdad entre categorías del mismo
-- torneo (juveniles mejor de 3, máster mejor de 5) — no se fuerza un
-- único valor. Este campo es solo el default con el que arranca el
-- selector al confirmar cada categoría; se puede cambiar categoría por
-- categoría igual que antes.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS default_best_of_sets SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_default_best_of_sets_check'
  ) THEN
    ALTER TABLE tournaments
      ADD CONSTRAINT tournaments_default_best_of_sets_check
      CHECK (default_best_of_sets IN (3, 5, 7));
  END IF;
END $$;
