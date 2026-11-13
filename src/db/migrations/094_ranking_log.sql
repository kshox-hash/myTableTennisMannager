-- Historial de cada ranking del organizador: qué campeonatos se le sumaron
-- (o se le sacaron), cuándo y quién lo hizo. Así se puede revisar de dónde
-- sale el resultado de un ranking.
CREATE TABLE IF NOT EXISTS ranking_log (
  id_log        BIGSERIAL PRIMARY KEY,
  id_ranking    UUID NOT NULL REFERENCES rankings(id_ranking) ON DELETE CASCADE,
  id_tournament UUID NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('added', 'removed')),
  id_user       UUID REFERENCES users(id_user) ON DELETE SET NULL,
  -- true = cargado al crear esta tabla (la fecha es la del campeonato, no la
  -- del momento en que se sumó, que antes no se guardaba).
  backfilled    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ranking_log_ranking ON ranking_log(id_ranking, created_at DESC);

INSERT INTO ranking_log (id_ranking, id_tournament, action, id_user, backfilled, created_at)
SELECT t.id_ranking, t.id_tournament, 'added', t.created_by, true, COALESCE(t.event_date::timestamptz, t.created_at)
FROM tournaments t
WHERE t.id_ranking IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ranking_log l WHERE l.id_tournament = t.id_tournament);
