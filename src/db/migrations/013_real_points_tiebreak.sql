-- ============================================================
--  013 — Puntos reales como criterio de desempate
--  El "points" anterior era un puntaje artificial (2 por ganar, 1 por
--  perder jugando, 0 por walkover) que no corresponde a ninguna regla
--  real de tenis de mesa. Se reemplaza por los puntos de juego reales
--  (suma de los puntos de cada set jugado), usados solo como desempate
--  cuando el ganador-perdedor y los sets quedan iguales.
-- ============================================================

ALTER TABLE group_standings
  ADD COLUMN IF NOT EXISTS points_for     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_against INT NOT NULL DEFAULT 0;

ALTER TABLE group_standings
  DROP COLUMN IF EXISTS points;
