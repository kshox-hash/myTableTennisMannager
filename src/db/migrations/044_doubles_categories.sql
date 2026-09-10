-- ============================================================
--  044 — Categorías de dobles
--  Una pareja de dobles se modela como un "usuario equipo" (users con
--  is_team = true): así ocupa el mismo lugar que un jugador en TODO el
--  motor ya existente (inscripciones, grupos, standings, llaves, mesas,
--  seeding) sin tener que tocar esas tablas. doubles_teams guarda quiénes
--  son los dos jugadores reales detrás de ese equipo.
--
--  Al cargar un resultado de dobles, los puntos de ranking se le acreditan
--  a los DOS jugadores reales (ver brackets_repository), no al usuario
--  equipo — el usuario equipo nunca entra a player_stats ni al ranking.
-- ============================================================

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS format VARCHAR(10) NOT NULL DEFAULT 'singles'
    CHECK (format IN ('singles', 'doubles'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_team BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS doubles_teams (
  id_user      UUID        PRIMARY KEY REFERENCES users(id_user) ON DELETE CASCADE,
  id_player_1  UUID        NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  id_player_2  UUID        NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  id_category  UUID        NOT NULL REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id_player_1 <> id_player_2)
);

CREATE INDEX IF NOT EXISTS idx_doubles_teams_category ON doubles_teams (id_category);
CREATE INDEX IF NOT EXISTS idx_doubles_teams_players  ON doubles_teams (id_player_1, id_player_2);
