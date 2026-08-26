-- ============================================================
--  014 — Prioridad de mesas por categoría
--  Cuando corren varias categorías al mismo tiempo (TC, Infantil, Mixto...)
--  y comparten el mismo pool de mesas del torneo, esto define qué categoría
--  se favorece al repartir las mesas libres. 0 = prioridad más baja.
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS table_priority INT NOT NULL DEFAULT 1
    CHECK (table_priority >= 0 AND table_priority <= 2);
