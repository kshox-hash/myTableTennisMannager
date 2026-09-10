-- ============================================================
--  045 — Ligas internas (fase 1)
--
--  Una liga reusa el modelo de datos de la fase de grupos:
--    tournaments (kind='league') + 1 tournament_categories
--    + N category_groups  = divisiones
--    + group_members / group_matches / group_standings
--  Así el registro de resultados (POST /bracket/matches/:id/result) y el
--  recálculo de tabla/estadísticas/ranking funcionan sin cambios. Lo único
--  propio de la liga: el fixture (todos contra todos por división,
--  repartido en jornadas usando group_matches.round_number) y la tabla
--  ordenada por PUNTOS de liga (2-1-0 / 3-0), que se calcula al leer.
-- ============================================================

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'tournament'
    CHECK (kind IN ('tournament', 'league'));

-- Una división de liga puede tener bastantes más de 4 jugadores.
ALTER TABLE category_groups DROP CONSTRAINT IF EXISTS category_groups_target_size_check;
ALTER TABLE category_groups ADD  CONSTRAINT category_groups_target_size_check
  CHECK (target_size >= 2 AND target_size <= 64);

-- 'league' como tipo de grupo (= una división de liga).
ALTER TABLE category_groups DROP CONSTRAINT IF EXISTS category_groups_group_kind_check;
ALTER TABLE category_groups ADD  CONSTRAINT category_groups_group_kind_check
  CHECK (group_kind IN ('normal', 'manual', 'playoff_two', 'league'));

CREATE TABLE IF NOT EXISTS league_config (
  id_tournament UUID        PRIMARY KEY REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  season        VARCHAR(60),
  -- '2-1-0' = 2 pts por victoria, 1 por derrota jugada, 0 por walkover perdido.
  -- '3-0'   = 3 pts por victoria, 0 por derrota.
  scoring       VARCHAR(10) NOT NULL DEFAULT '2-1-0' CHECK (scoring IN ('2-1-0', '3-0')),
  -- Ida y vuelta (fase 2) — la columna queda lista.
  double_round  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_kind ON tournaments (kind) WHERE kind = 'league';
