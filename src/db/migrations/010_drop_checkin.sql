-- ============================================================
--  010 — Elimina el check-in de jugadores
--  La feature de check-in se sacó de la app: no se usaba para nada
--  (no filtraba la fase de grupos ni ningún otro flujo).
-- ============================================================

ALTER TABLE enrollments
  DROP COLUMN IF EXISTS checked_in,
  DROP COLUMN IF EXISTS checked_in_at;
