-- ============================================================
--  050 — Un club por admin
--
--  Cada admin puede tener UN solo club (evita que una misma cuenta arme
--  varios y confunda a los jugadores sobre a cuál pedir unirse). El
--  chequeo ya vive en clubs_router.ts (POST /clubs), esto es la misma
--  regla a nivel de base para no depender solo de una condición de
--  carrera evitada en la app — mismo criterio que
--  idx_club_join_requests_one_pending en 049_clubs.sql.
--
--  Antes de crear el índice único hay que dedupear: algunas cuentas ya
--  habían creado más de un club antes de que existiera esta restricción
--  (el chequeo en el router es de después) — se queda con el más antiguo
--  de cada admin y borra el resto. ON DELETE CASCADE (club_join_requests)
--  y ON DELETE SET NULL (users.id_club) limpian solos lo que dependía de
--  los clubes borrados.
-- ============================================================
DELETE FROM clubs c
WHERE c.created_by IS NOT NULL
  AND c.id_club NOT IN (
    SELECT DISTINCT ON (created_by) id_club
    FROM clubs
    WHERE created_by IS NOT NULL
    ORDER BY created_by, created_at ASC
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_one_per_admin
  ON clubs (created_by) WHERE created_by IS NOT NULL;
