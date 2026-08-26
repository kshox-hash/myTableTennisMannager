-- ============================================================
--  023 — Cola de mesas: orden manual + saca la prioridad de categoría
--  La prioridad de categoría (014_table_priority.sql) no se usa más — el
--  admin ahora ordena la cola de despacho directamente, partido por
--  partido (ver dispatch_priority), en vez de por categoría.
--  dispatch_priority nace de una secuencia compartida entre group_matches
--  y bracket_matches para que el orden natural (por fecha de creación)
--  sea el mismo con el que ya se venía mostrando la cola. Reordenar la
--  cola es intercambiar el valor entre dos partidos (mismo patrón que
--  swap de grupos), no reindexar todo.
-- ============================================================

ALTER TABLE tournament_categories
  DROP COLUMN IF EXISTS table_priority;

CREATE SEQUENCE IF NOT EXISTS dispatch_priority_seq;

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS dispatch_priority INT NOT NULL DEFAULT nextval('dispatch_priority_seq');

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS dispatch_priority INT NOT NULL DEFAULT nextval('dispatch_priority_seq');
