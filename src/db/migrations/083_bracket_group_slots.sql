-- Llave adelantada: se arma antes de que terminen los grupos, con cupos como
-- "1° GR-3" que se llenan solos cuando ese grupo termina.
ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS player1_source_group UUID REFERENCES category_groups(id_group) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player1_source_rank  SMALLINT,
  ADD COLUMN IF NOT EXISTS player2_source_group UUID REFERENCES category_groups(id_group) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS player2_source_rank  SMALLINT;
