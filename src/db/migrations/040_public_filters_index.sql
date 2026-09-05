-- Índices para las condiciones que arma public_tournament_repository.ts →
-- list() al filtrar por región y por categoría/género en /torneos: hoy
-- corren con sequential scan porque ninguna de las dos columnas tenía
-- índice. A la escala actual no se nota, pero es el momento barato de
-- agregarlo, antes de que la tabla crezca con el uso real.
--
-- Parcial (WHERE visibility = 'public'): matchea exactamente la condición
-- fija que ya arma list() (`t.visibility = 'public'`), así el índice queda
-- más chico y solo cubre las filas que ese filtro realmente va a tocar.
CREATE INDEX IF NOT EXISTS idx_tournaments_region_public
  ON tournaments (region)
  WHERE visibility = 'public';

-- Compuesto: matchea el EXISTS que arma list() cuando se filtra por
-- categoryType y/o gender (category_range no entra acá porque nunca se
-- filtra sola sin categoryType/gender en la práctica de la UI actual).
CREATE INDEX IF NOT EXISTS idx_tournament_categories_type_gender
  ON tournament_categories (category_type, gender);
