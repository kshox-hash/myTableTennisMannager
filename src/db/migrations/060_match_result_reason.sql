-- ============================================================
--  060 — Motivo de un resultado no jugado
--
--  Pedido del circuito (categorías paralímpicas, pero aplica a todas):
--  un jugador se lesiona, abandona, no se presenta o lo descalifican, y
--  el partido se da por ganado al rival. Antes solo existía "No se
--  jugó" (status 'walkover') sin decir por qué. El resultado se sigue
--  guardando igual que un walkover (mismas estadísticas y tablas); esta
--  columna solo agrega el motivo para mostrarlo. NULL = partido jugado
--  normal, o walkover antiguo sin motivo.
-- ============================================================

ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS result_reason VARCHAR(20)
    CHECK (result_reason IN ('no_show', 'injury', 'retired', 'disqualified'));

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS result_reason VARCHAR(20)
    CHECK (result_reason IN ('no_show', 'injury', 'retired', 'disqualified'));
