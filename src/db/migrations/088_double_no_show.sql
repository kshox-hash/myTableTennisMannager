-- ============================================================
--  088 — Ninguno de los dos se presentó (W.O. doble)
--
--  Pasó en un campeonato: dos inscritos no llegaron y les tocaba jugar
--  entre ellos. Con 060 solo se podía marcar a UNO como "no se
--  presentó" y el otro ganaba solo. Ahora el partido se cierra sin
--  ganador (winner_id NULL, status 'walkover') con este motivo: cuenta
--  como partido perdido para los dos, 0-0 en sets, y nadie suma victoria.
--  Por ahora solo en fase de grupos (en la llave alguien tiene que avanzar).
-- ============================================================

ALTER TABLE group_matches DROP CONSTRAINT IF EXISTS group_matches_result_reason_check;
ALTER TABLE group_matches
  ADD CONSTRAINT group_matches_result_reason_check
    CHECK (result_reason IN ('no_show', 'injury', 'retired', 'disqualified', 'double_no_show'));
