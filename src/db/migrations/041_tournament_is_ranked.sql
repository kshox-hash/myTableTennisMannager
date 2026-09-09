-- ============================================================
--  041 — Torneos no puntuables (is_ranked)
-- ============================================================
-- Independiente de `visibility` (038): un torneo puede ser privado y
-- seguir sumando puntos al ranking público, o puede ser público y no
-- sumar (torneo de prueba, amistoso, exhibición). Antes no existía forma
-- de desacoplar ambas cosas, así que cualquier torneo -- incluso uno
-- "private" -- alimentaba el ranking público solo por jugarse (bug #4
-- del reporte QA).
--
-- Puntuable por defecto (TRUE): apagarlo es la excepción, no la regla.
-- El gate real de si un partido suma o no puntos vive en
-- BracketsRepository.recordMatchResult / recordBracketResult /
-- undoGroupMatchResult (src/brackets/brackets_repository.ts) -- ahí se
-- consulta este flag antes de tocar player_stats.ranking_points.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS is_ranked BOOLEAN NOT NULL DEFAULT TRUE;
