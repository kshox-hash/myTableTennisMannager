-- Formato "1 set a 21 puntos": hasta ahora best_of_sets solo admitía 3/5/7
-- (siempre a 11 puntos, implícito en el código — ver isLegalSetScore en
-- brackets_service.ts). Se agrega 1 como valor válido de best_of_sets y
-- una columna explícita de puntos por set (11 u 21), en los mismos 3
-- lugares donde ya vive best_of_sets (torneo, partido de grupo, partido de
-- llave) — mismo patrón de columna, mismo flujo de generación.
ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_default_best_of_sets_check,
  ADD CONSTRAINT tournaments_default_best_of_sets_check CHECK (default_best_of_sets IN (1, 3, 5, 7)),
  ADD COLUMN IF NOT EXISTS default_points_per_set SMALLINT NOT NULL DEFAULT 11 CHECK (default_points_per_set IN (11, 21));

ALTER TABLE group_matches
  DROP CONSTRAINT IF EXISTS group_matches_best_of_sets_check,
  ADD CONSTRAINT group_matches_best_of_sets_check CHECK (best_of_sets IN (1, 3, 5, 7)),
  ADD COLUMN IF NOT EXISTS points_per_set SMALLINT NOT NULL DEFAULT 11 CHECK (points_per_set IN (11, 21));

ALTER TABLE bracket_matches
  DROP CONSTRAINT IF EXISTS bracket_matches_best_of_sets_check,
  ADD CONSTRAINT bracket_matches_best_of_sets_check CHECK (best_of_sets IN (1, 3, 5, 7)),
  ADD COLUMN IF NOT EXISTS points_per_set SMALLINT NOT NULL DEFAULT 11 CHECK (points_per_set IN (11, 21));
