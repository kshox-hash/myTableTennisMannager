-- ============================================================
--  020 — Horario planificado de mesas (solo fase de grupos)
--  scheduled_table_number / scheduled_start_at son el PLAN (se arma de
--  antemano, antes de que arranque el torneo) — distinto de table_number,
--  que sigue siendo el estado EN VIVO (a qué mesa está sentado un partido
--  en este momento). El scheduler de activación (table_schedule_scheduler.ts)
--  es el que copia el plan al estado en vivo cuando llega la hora.
--  match_duration_minutes es un valor de conveniencia en tournaments: guarda
--  la última duración usada para prellenarla la próxima vez que se genere.
-- ============================================================

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS scheduled_table_number SMALLINT,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS match_duration_minutes SMALLINT;
