-- ============================================================
--  006 — Seed por inscripción
--  Permite al admin asignar cabeza de serie antes de generar llaves
-- ============================================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS seed INTEGER;
