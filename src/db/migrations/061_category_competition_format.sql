-- ============================================================
--  061 — Formato de competencia por categoría
--
--  'groups_bracket' (lo de siempre): grupos de 2-4 → llave eliminatoria.
--  'round_robin' (grupo único): todos contra todos en un solo grupo; al
--  terminar todos los partidos la categoría se cierra sola y el podio
--  (1°, 2°, 3°, 4°) sale de la tabla de posiciones. Pedido del circuito
--  para categorías chicas (ej. paralímpicas).
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS competition_format VARCHAR(20) NOT NULL DEFAULT 'groups_bracket'
    CHECK (competition_format IN ('groups_bracket', 'round_robin'));
