-- ============================================================
--  myTableTennisMannager — Schema completo
--  Generado desde el análisis del backend (Express 5 + TypeScript)
--  Ejecutar en orden. Requiere PostgreSQL 14+.
-- ============================================================

-- Extensión para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
--  DROP (en orden inverso de dependencias)
-- ============================================================
DROP TABLE IF EXISTS player_stats           CASCADE;
DROP TABLE IF EXISTS bracket_matches        CASCADE;
DROP TABLE IF EXISTS group_standings        CASCADE;
DROP TABLE IF EXISTS group_members          CASCADE;
DROP TABLE IF EXISTS group_matches          CASCADE;
DROP TABLE IF EXISTS category_groups        CASCADE;
DROP TABLE IF EXISTS enrollments            CASCADE;
DROP TABLE IF EXISTS tournament_categories  CASCADE;
DROP TABLE IF EXISTS tournaments            CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
DROP TABLE IF EXISTS clubs                  CASCADE;
DROP TABLE IF EXISTS roles                  CASCADE;

-- ============================================================
--  ROLES
-- ============================================================
CREATE TABLE roles (
  id_role  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name     VARCHAR(30)  NOT NULL UNIQUE
);

-- IDs fijos que el backend usa en src/core/constants/roles.ts
INSERT INTO roles (id_role, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'player');

-- ============================================================
--  CLUBS
-- ============================================================
CREATE TABLE clubs (
  id_club  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name     VARCHAR(150) NOT NULL
);

-- ============================================================
--  USERS
-- ============================================================
CREATE TABLE users (
  id_user       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  id_role       UUID         NOT NULL REFERENCES roles(id_role),
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  gender        VARCHAR(10)  CHECK (gender IN ('male', 'female', 'other')),
  id_club       UUID         REFERENCES clubs(id_club) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
--  TOURNAMENTS
-- ============================================================
CREATE TABLE tournaments (
  id_tournament   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_name VARCHAR(150) NOT NULL,
  description     TEXT,
  created_by      UUID         NOT NULL REFERENCES users(id_user),
  allow_mixed     BOOLEAN      NOT NULL DEFAULT TRUE,
  allow_olympic   BOOLEAN      NOT NULL DEFAULT FALSE,
  address         VARCHAR(255),
  region          VARCHAR(100),
  event_date      DATE,
  event_time      TIME,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
--  TOURNAMENT_CATEGORIES
-- ============================================================
CREATE TABLE tournament_categories (
  id_category       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament     UUID          NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  category_type     VARCHAR(20)   NOT NULL,
  category_range    VARCHAR(100)  NOT NULL,
  gender            VARCHAR(10)   NOT NULL CHECK (gender IN ('male', 'female', 'mixed')),
  inscription_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  quotas            INT           CHECK (quotas > 0),        -- NULL = sin límite
  status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'closed', 'cancelled')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournament_categories_tournament
  ON tournament_categories (id_tournament);

-- ============================================================
--  ENROLLMENTS
-- ============================================================
CREATE TABLE enrollments (
  id_enrollment      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID         NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  id_tournament      UUID         NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_category        UUID         NOT NULL REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  status             VARCHAR(20)  NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'cancelled')),
  enrolled_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  qualification_type VARCHAR(30)  NOT NULL DEFAULT 'group'
                                  CHECK (qualification_type IN ('group', 'direct_advance', 'late_entry')),

  UNIQUE (id_user, id_tournament, id_category)
);

CREATE INDEX idx_enrollments_tournament ON enrollments (id_tournament);
CREATE INDEX idx_enrollments_user       ON enrollments (id_user);
CREATE INDEX idx_enrollments_category   ON enrollments (id_category);

-- ============================================================
--  CATEGORY_GROUPS  (fase de grupos)
-- ============================================================
CREATE TABLE category_groups (
  id_group    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament UUID       NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_category   UUID       NOT NULL REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  group_name  VARCHAR(10)  NOT NULL,                 -- "A", "B", "C" ...
  target_size SMALLINT     NOT NULL CHECK (target_size IN (2, 3, 4)),
  sort_order  INT          NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'active', 'finished')),
  group_kind  VARCHAR(20)  NOT NULL DEFAULT 'normal'
                           CHECK (group_kind IN ('normal', 'manual', 'playoff_two')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_groups_tournament_category
  ON category_groups (id_tournament, id_category);

-- ============================================================
--  GROUP_MEMBERS
-- ============================================================
CREATE TABLE group_members (
  id_group        UUID         NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_user         UUID         NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  seed            INT,
  assignment_type VARCHAR(10)  NOT NULL DEFAULT 'auto'
                               CHECK (assignment_type IN ('auto', 'manual')),
  PRIMARY KEY (id_group, id_user)
);

-- ============================================================
--  GROUP_STANDINGS  (tabla de posiciones, se actualiza con cada resultado)
-- ============================================================
CREATE TABLE group_standings (
  id_group             UUID       NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_user              UUID       NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  played               INT        NOT NULL DEFAULT 0,
  won                  INT        NOT NULL DEFAULT 0,
  lost                 INT        NOT NULL DEFAULT 0,
  points               INT        NOT NULL DEFAULT 0,
  sets_for             INT        NOT NULL DEFAULT 0,
  sets_against         INT        NOT NULL DEFAULT 0,
  position             INT,
  qualified_to_bracket BOOLEAN    NOT NULL DEFAULT FALSE,
  qualification_label  VARCHAR(10) CHECK (qualification_label IN ('first', 'second')),
  PRIMARY KEY (id_group, id_user)
);

CREATE INDEX idx_group_standings_group ON group_standings (id_group);

-- ============================================================
--  GROUP_MATCHES  (partidos todos contra todos dentro del grupo)
-- ============================================================
CREATE TABLE group_matches (
  id_match      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_group      UUID         NOT NULL REFERENCES category_groups(id_group) ON DELETE CASCADE,
  id_tournament UUID         NOT NULL,
  id_category   UUID         NOT NULL,
  stage         VARCHAR(20)  NOT NULL DEFAULT 'group',
  round_number  INT          NOT NULL DEFAULT 1,
  match_number  INT          NOT NULL,
  best_of_sets  SMALLINT     NOT NULL DEFAULT 3 CHECK (best_of_sets IN (3, 5, 7)),
  player1_id    UUID         NOT NULL REFERENCES users(id_user),
  player2_id    UUID         NOT NULL REFERENCES users(id_user),
  winner_id     UUID         REFERENCES users(id_user),
  sets_player1  INT          NOT NULL DEFAULT 0,
  sets_player2  INT          NOT NULL DEFAULT 0,
  status        VARCHAR(20)  NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'played', 'walkover')),
  source_note   VARCHAR(30)  NOT NULL DEFAULT 'group_stage'
                             CHECK (source_note IN ('group_stage', 'two_player_group')),
  played_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_matches_group    ON group_matches (id_group);
CREATE INDEX idx_group_matches_players  ON group_matches (player1_id, player2_id);

-- ============================================================
--  BRACKET_MATCHES  (cuadro eliminatorio / llaves)
--
--  Avance del ganador:
--    next_round + next_match_number + next_match_slot
--    indican a qué partido va el ganador y en qué slot (1 o 2).
--    Se usa UNIQUE(tournament, category, round, match_number)
--    para buscar ese partido sin FK circular.
-- ============================================================
CREATE TABLE bracket_matches (
  id_match          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament     UUID         NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_category       UUID         NOT NULL REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  round             INT          NOT NULL,
  match_number      INT          NOT NULL,
  player1_id        UUID         REFERENCES users(id_user),
  player2_id        UUID         REFERENCES users(id_user),
  next_round        INT,
  next_match_number INT,
  next_match_slot   SMALLINT     CHECK (next_match_slot IN (1, 2)),
  winner_id         UUID         REFERENCES users(id_user),
  sets_player1      INT          NOT NULL DEFAULT 0,
  sets_player2      INT          NOT NULL DEFAULT 0,
  best_of_sets      SMALLINT     NOT NULL DEFAULT 5 CHECK (best_of_sets IN (3, 5, 7)),
  is_bye            BOOLEAN      NOT NULL DEFAULT FALSE,
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'ready', 'played', 'walkover', 'bye')),
  played_at         TIMESTAMPTZ,

  UNIQUE (id_tournament, id_category, round, match_number)
);

CREATE INDEX idx_bracket_matches_tournament_category
  ON bracket_matches (id_tournament, id_category);

-- ============================================================
--  PLAYER_STATS  (estadísticas globales de carrera)
--
--  Se actualiza automáticamente cada vez que finaliza un partido
--  (fase de grupos o cuadro eliminatorio).
--  Walkover: solo cuenta para el ganador, no para el perdedor.
-- ============================================================
CREATE TABLE player_stats (
  id_user        UUID        PRIMARY KEY REFERENCES users(id_user) ON DELETE CASCADE,
  matches_played INT         NOT NULL DEFAULT 0,
  matches_won    INT         NOT NULL DEFAULT 0,
  matches_lost   INT         NOT NULL DEFAULT 0,
  sets_won       INT         NOT NULL DEFAULT 0,
  sets_lost      INT         NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  FIN
-- ============================================================
