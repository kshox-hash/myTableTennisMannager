-- ============================================================
--  024 — Revierte 023: vuelve la cola de mesas a manual + prioridad
--  de categoría. dispatch_priority y el reordenamiento por click no se
--  usan más — se vuelve a elegir el partido a mano por mesa, con
--  "Auto-asignar mesas libres" como acción explícita.
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS table_priority INT NOT NULL DEFAULT 1
    CHECK (table_priority >= 0 AND table_priority <= 2);

ALTER TABLE group_matches
  DROP COLUMN IF EXISTS dispatch_priority;

ALTER TABLE bracket_matches
  DROP COLUMN IF EXISTS dispatch_priority;

DROP SEQUENCE IF EXISTS dispatch_priority_seq;
