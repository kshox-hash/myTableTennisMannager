-- ============================================================
--  025 — Elimina la prioridad de categorías
--  No se usa: la cola de mesas reparte por turno rotativo entre
--  categorías, sin necesidad de que el admin le asigne prioridad a nada.
-- ============================================================

ALTER TABLE tournament_categories
  DROP COLUMN IF EXISTS table_priority;
