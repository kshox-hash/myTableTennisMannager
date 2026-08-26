-- ============================================================
--  005 — Check-in de jugadores
--  Agrega confirmación de asistencia en enrollments
-- ============================================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS checked_in    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
