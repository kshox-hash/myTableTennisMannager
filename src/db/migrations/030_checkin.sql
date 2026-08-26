-- ============================================================
--  030 — Check-in de asistencia (vuelve a agregar lo que se sacó
--  en 010, pero esta vez conectado a la generación de grupos:
--  ver brackets_repository.ts loadPlayersForCategory/loadDirectEntryPlayers).
--  Default TRUE: si el admin nunca toca el check-in, el comportamiento
--  es idéntico al de hoy (todos entran a grupos) — falla abierto, no cierra.
-- ============================================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS checked_in BOOLEAN NOT NULL DEFAULT TRUE;
