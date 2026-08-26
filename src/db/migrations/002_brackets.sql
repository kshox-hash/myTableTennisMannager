-- Grupos generados para una categoría de torneo
CREATE TABLE IF NOT EXISTS category_groups (
  id_group    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament UUID       NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_category   UUID       NOT NULL REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  group_name  VARCHAR(10)  NOT NULL,
  target_size SMALLINT     NOT NULL CHECK (target_size IN (2, 3, 4)),
  sort_order  INT          NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'finished')),
  group_kind  VARCHAR(20)  NOT NULL DEFAULT 'normal' CHECK (group_kind IN ('normal', 'manual', 'playoff_two')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Jugadores asignados a cada grupo
CREATE TABLE IF NOT EXISTS group_members (
  id_group        UUID         NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_user         UUID         NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  seed            INT,
  assignment_type VARCHAR(10)  NOT NULL DEFAULT 'auto' CHECK (assignment_type IN ('auto', 'manual')),
  PRIMARY KEY (id_group, id_user)
);

-- Tabla de posiciones por grupo (se actualiza con cada resultado)
CREATE TABLE IF NOT EXISTS group_standings (
  id_group             UUID     NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_user              UUID     NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  played               INT      NOT NULL DEFAULT 0,
  won                  INT      NOT NULL DEFAULT 0,
  lost                 INT      NOT NULL DEFAULT 0,
  points               INT      NOT NULL DEFAULT 0,
  sets_for             INT      NOT NULL DEFAULT 0,
  sets_against         INT      NOT NULL DEFAULT 0,
  position             INT,
  qualified_to_bracket BOOLEAN  NOT NULL DEFAULT FALSE,
  qualification_label  VARCHAR(10) CHECK (qualification_label IN ('first', 'second')),
  PRIMARY KEY (id_group, id_user)
);

-- Partidos del grupo (todos contra todos)
CREATE TABLE IF NOT EXISTS group_matches (
  id_match    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_group    UUID         NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_tournament UUID       NOT NULL,
  id_category   UUID       NOT NULL,
  stage         VARCHAR(20) NOT NULL DEFAULT 'group',
  round_number  INT         NOT NULL DEFAULT 1,
  match_number  INT         NOT NULL,
  best_of_sets  SMALLINT    NOT NULL DEFAULT 3 CHECK (best_of_sets IN (3, 5, 7)),
  player1_id    UUID        NOT NULL REFERENCES users(id_user),
  player2_id    UUID        NOT NULL REFERENCES users(id_user),
  winner_id     UUID        REFERENCES users(id_user),
  sets_player1  INT         NOT NULL DEFAULT 0,
  sets_player2  INT         NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'played', 'walkover')),
  source_note   VARCHAR(30) NOT NULL DEFAULT 'group_stage' CHECK (source_note IN ('group_stage', 'two_player_group')),
  played_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_category_groups_tournament_category
  ON category_groups (id_tournament, id_category);

CREATE INDEX IF NOT EXISTS idx_group_matches_group
  ON group_matches (id_group);

CREATE INDEX IF NOT EXISTS idx_group_standings_group
  ON group_standings (id_group);
