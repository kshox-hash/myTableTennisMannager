-- Formato "Oro y Plata": una categoría de Oro puede tener una categoría
-- Plata hermana, que se puebla sola con los no clasificados de los grupos
-- de Oro (ver TournamentPhaseService.populateSilverBracket) y salta
-- directo a su propia llave sin pasar por fase de grupos. Plata es, para
-- el resto del sistema, una categoría normal más — solo esta columna en
-- la fila de Oro marca el vínculo.
ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS silver_category_id UUID NULL
    REFERENCES tournament_categories(id_category) ON DELETE SET NULL;
