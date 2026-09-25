-- ============================================================
--  056 — Ser dueño de un club NO te hace socio (jugador) de él
--
--  Antes, crear un club asignaba users.id_club = ese club al dueño
--  automáticamente. Regla nueva: el organizador que quiera jugar por su
--  club manda la solicitud como cualquiera y la acepta él mismo.
--  Acá se sacan los dueños que quedaron socios por esa asignación
--  automática — solo los que NUNCA tuvieron una solicitud aprobada a su
--  propio club (si la tuvieron, son socios de verdad y se respetan).
-- ============================================================

UPDATE users u
SET id_club = NULL
FROM clubs c
WHERE c.id_club = u.id_club
  AND c.created_by = u.id_user
  AND NOT EXISTS (
    SELECT 1 FROM club_join_requests r
    WHERE r.id_user = u.id_user
      AND r.id_club = c.id_club
      AND r.status = 'approved'
  );
