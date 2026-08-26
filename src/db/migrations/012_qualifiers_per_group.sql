-- ============================================================
--  012 — Clasificados por grupo configurables
--  Antes era un valor fijo (2) elegido recién al generar el cuadro.
--  Ahora se define por categoría al crear/editar el campeonato, y cada
--  grupo hereda ese valor pero se puede ajustar manualmente después.
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS qualifiers_per_group INT NOT NULL DEFAULT 2
    CHECK (qualifiers_per_group >= 1 AND qualifiers_per_group <= 4);

ALTER TABLE category_groups
  ADD COLUMN IF NOT EXISTS qualifiers_per_group INT NOT NULL DEFAULT 2
    CHECK (qualifiers_per_group >= 1 AND qualifiers_per_group <= 4);
