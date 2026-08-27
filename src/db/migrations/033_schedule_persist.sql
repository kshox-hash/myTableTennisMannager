-- ============================================================
--  033 — Horario planificado de mesas, de vuelta (solo fase de grupos)
--  Repone lo que sacó la 022. scheduled_table_number / scheduled_start_at
--  son el PLAN (se confirma de antemano, antes de que arranque la
--  jornada) — distinto de table_number, que es el estado EN VIVO (a qué
--  mesa está sentado un partido en este momento). El scheduler de
--  activación (table_schedule_scheduler.ts) copia el plan al estado en
--  vivo cuando llega la hora, vía el mismo assignTable() que usa el
--  despacho manual.
--  match_duration_minutes es un valor de conveniencia en tournaments:
--  guarda la última duración usada para prellenarla la próxima vez.
-- ============================================================

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS scheduled_table_number SMALLINT,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS match_duration_minutes SMALLINT;
