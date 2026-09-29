-- ============================================================
--  063 — Partido llamado fuera del orden de la cola
-- ============================================================
-- true cuando el organizador mandó el partido a una mesa sin ser el primero
-- de la cola de despacho ("se adelantó"). La app lo muestra en Mesas y en la
-- tarjeta "Tu turno"; a quienes estaban antes en la cola se les avisa.
ALTER TABLE group_matches
  ADD COLUMN IF NOT EXISTS called_out_of_order BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE bracket_matches
  ADD COLUMN IF NOT EXISTS called_out_of_order BOOLEAN NOT NULL DEFAULT false;
