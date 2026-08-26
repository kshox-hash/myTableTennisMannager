-- ============================================================
--  019 — Número de jugador dentro del grupo (1, 2, 3...)
--  Guarda el puesto fijo que le tocó a cada jugador dentro de SU
--  grupo (no la semilla global del torneo) — es el mismo orden que
--  usa generateRoundRobinMatches para armar los cruces (1v3, 1v2,
--  2v3...). Se asigna al crear el grupo; si se agrega un jugador
--  después, le toca el siguiente número consecutivo del grupo.
-- ============================================================

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS group_position SMALLINT;
