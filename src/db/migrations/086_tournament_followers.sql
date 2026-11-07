-- Seguir un campeonato sin jugarlo ("visita"): un familiar, un compañero de
-- club o un fan que quiere enterarse de cómo va. Recibe avisos de los
-- momentos importantes (empezó una categoría, salió la llave, hay campeón,
-- cambió la fecha/lugar, se canceló) — ver src/notifications/followers.ts.
CREATE TABLE IF NOT EXISTS tournament_followers (
  id_tournament UUID NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_user       UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_tournament, id_user)
);

-- "Campeonatos que sigo" de un usuario.
CREATE INDEX IF NOT EXISTS idx_tournament_followers_user ON tournament_followers (id_user, created_at DESC);
