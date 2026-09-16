-- ============================================================
--  055 — Foto de organizador separada de la foto de jugador
--
--  Mismo motivo que 054 (nombre de organizador): una cuenta admin
--  también navega el área de jugador con el mismo id_user, y ambas
--  vistas compartían avatar_url — cambiar la foto como jugador también
--  cambiaba la foto pública del organizador. NULL = sigue usando
--  avatar_url (ver ORGANIZER_AVATAR_SQL), así ningún admin existente
--  queda sin foto.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organizer_avatar_url TEXT;
