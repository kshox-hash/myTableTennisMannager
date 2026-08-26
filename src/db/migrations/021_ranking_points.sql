-- ============================================================
--  021 — Ranking global (puntos por jugador)
--  Suma un puntaje simple (puntos por victoria) a player_stats, la tabla
--  global por jugador que ya se actualiza de forma incremental en cada
--  resultado de partido (ver recordMatchResult/undoGroupMatchResult/
--  recordBracketResult en brackets_repository.ts). La POSICIÓN en el
--  ranking no se guarda — se calcula al leer (ver ranking_repository.ts),
--  para no tener que recalcular a todos los jugadores de la plataforma
--  cada vez que se juega un partido en cualquier torneo.
-- ============================================================

ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS ranking_points INTEGER NOT NULL DEFAULT 0;
