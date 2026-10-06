-- Campeonatos de varios días: cada categoría puede tener su día y hora de
-- inicio; el campeonato guarda su fecha de término (último día usado) y
-- cuántas horas dura una jornada (para la sugerencia automática de días).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS day_hours SMALLINT NOT NULL DEFAULT 9;

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS play_date DATE,
  ADD COLUMN IF NOT EXISTS start_time TIME;
