-- ============================================================
--  054 — Nombre de organizador separado del nombre de jugador
--
--  Una cuenta admin también puede navegar el área de jugador (mismo
--  id_user, ver ROLE_RANK/availableViews) — hasta ahora ambas vistas
--  compartían first_name/last_name, así que cambiar el nombre como
--  jugador (para inscribirse en un torneo) también cambiaba el nombre
--  público del organizador (Comunidad, "X presenta"). NULL = sigue
--  usando first_name/last_name (ver ORGANIZER_NAME_SQL con COALESCE),
--  así ningún admin existente queda con nombre en blanco.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organizer_first_name TEXT,
  ADD COLUMN IF NOT EXISTS organizer_last_name  TEXT;
