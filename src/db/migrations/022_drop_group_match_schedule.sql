-- ============================================================
--  022 — Elimina el horario planificado de partidos de grupo
--  La feature se sacó de la app: los partidos de grupo vuelven a pasar
--  siempre por el despacho manual/auto-asignar de mesas (ver 020).
-- ============================================================

ALTER TABLE group_matches
  DROP COLUMN IF EXISTS scheduled_table_number,
  DROP COLUMN IF EXISTS scheduled_start_at;

ALTER TABLE tournaments
  DROP COLUMN IF EXISTS match_duration_minutes;
