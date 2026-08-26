-- Agregar tipo de clasificación a la inscripción
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS qualification_type VARCHAR(30) NOT NULL DEFAULT 'group'
    CHECK (qualification_type IN ('group', 'direct_advance', 'late_entry'));

-- Cuadro eliminatorio (llaves)
-- round: 1 = primera ronda, sube hasta la final
-- next_round / next_match_number / next_match_slot: a qué partido va el ganador
CREATE TABLE IF NOT EXISTS bracket_matches (
  id_match         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_tournament    UUID        NOT NULL,
  id_category      UUID        NOT NULL,
  round            INT         NOT NULL,
  match_number     INT         NOT NULL,

  player1_id       UUID        REFERENCES users(id_user),
  player2_id       UUID        REFERENCES users(id_user),

  next_round       INT,
  next_match_number INT,
  next_match_slot  SMALLINT    CHECK (next_match_slot IN (1, 2)),

  winner_id        UUID        REFERENCES users(id_user),
  sets_player1     INT         NOT NULL DEFAULT 0,
  sets_player2     INT         NOT NULL DEFAULT 0,
  best_of_sets     SMALLINT    NOT NULL DEFAULT 5 CHECK (best_of_sets IN (3, 5, 7)),

  is_bye           BOOLEAN     NOT NULL DEFAULT FALSE,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'played', 'walkover', 'bye')),

  played_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (id_tournament, id_category, round, match_number)
);

CREATE INDEX IF NOT EXISTS idx_bracket_matches_tournament_category
  ON bracket_matches (id_tournament, id_category);
