-- ============================================================
--  050 — Un club por admin
--
--  Cada admin puede tener UN solo club (evita que una misma cuenta arme
--  varios y confunda a los jugadores sobre a cuál pedir unirse). El
--  chequeo ya vive en clubs_router.ts (POST /clubs), esto es la misma
--  regla a nivel de base para no depender solo de una condición de
--  carrera evitada en la app — mismo criterio que
--  idx_club_join_requests_one_pending en 049_clubs.sql.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_one_per_admin
  ON clubs (created_by) WHERE created_by IS NOT NULL;
