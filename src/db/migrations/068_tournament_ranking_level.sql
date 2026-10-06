-- Nivel del campeonato para el ranking (tabla de puntos ITTF/WTT):
--   local    = WTT Feeder     (125 campeón ... 2 en ronda de 64)
--   regional = WTT Contender  (400 campeón ... 4 en ronda de 32)
--   nacional = WTT Champions  (1000 campeón ... 15 en ronda de 32)
-- Los puntos se dan por la ronda alcanzada en la llave (ver ranking/ittf_points.ts).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS ranking_level VARCHAR(20) NOT NULL DEFAULT 'local'
  CHECK (ranking_level IN ('local', 'regional', 'nacional'));
