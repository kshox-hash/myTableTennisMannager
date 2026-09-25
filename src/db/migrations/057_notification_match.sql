-- ============================================================
--  057 — Partido de la notificación
--
--  Las notificaciones de partido (a mesa, resultado, próximo rival) solo
--  guardaban torneo/categoría, así que tocarlas llevaba a la categoría y
--  no al partido. Se guarda el partido (y si es de grupo o de llave, que
--  vive en tablas distintas). Sin FK: el id apunta a group_matches o a
--  bracket_matches según match_type. NULL en las que no son de partido.
-- ============================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS id_match UUID,
  ADD COLUMN IF NOT EXISTS match_type VARCHAR(10);
