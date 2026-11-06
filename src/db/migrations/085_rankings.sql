-- ============================================================
--  085 — Rankings del organizador (circuitos independientes)
-- ============================================================
-- Antes el ranking de un organizador sumaba TODOS los campeonatos que creó:
-- dos campeonatos sin relación (p. ej. el open de un club y el de otro)
-- quedaban mezclados en el mismo ranking y en el sembrado "interno".
--
-- Ahora cada organizador tiene uno o más rankings y cada campeonato suma a
-- uno solo (tournaments.id_ranking). NULL = todavía sin asignar: no suma a
-- ningún ranking del organizador (el general de la plataforma no cambia) y
-- al terminar el campeonato el panel pide elegir: ranking nuevo, uno que ya
-- existe o ninguno (is_ranked = false).
CREATE TABLE IF NOT EXISTS rankings (
  id_ranking UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_owner   UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rankings_owner ON rankings(id_owner);

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS id_ranking UUID REFERENCES rankings(id_ranking) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tournaments_ranking ON tournaments(id_ranking);

-- Lo ya jugado se queda como estaba: un "Ranking general" por organizador con
-- sus campeonatos pasados o con alguna categoría terminada (así nadie pierde
-- puntos). Los que están en curso o por venir quedan sin asignar y se eligen
-- al terminar.
INSERT INTO rankings (id_owner, name)
SELECT DISTINCT t.created_by, 'Ranking general'
FROM tournaments t
WHERE NOT EXISTS (SELECT 1 FROM rankings r WHERE r.id_owner = t.created_by);

UPDATE tournaments t
SET id_ranking = r.id_ranking
FROM rankings r
WHERE t.id_ranking IS NULL
  AND r.id_owner = t.created_by
  AND r.name = 'Ranking general'
  AND (
    COALESCE(t.event_date, t.created_at::date) < CURRENT_DATE
    OR EXISTS (SELECT 1 FROM tournament_categories tc WHERE tc.id_tournament = t.id_tournament AND tc.phase = 'finished')
  );
