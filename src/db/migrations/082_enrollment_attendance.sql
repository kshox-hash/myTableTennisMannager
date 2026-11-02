-- ============================================================
--  082 — Asistencia del inscrito
--
--    present  ya llegó
--    pending  dijo que viene y aún no llega: entra a los grupos con advertencia
--    absent   avisó que no viene: queda fuera al armar los grupos
--
--  checked_in sigue siendo lo que decide quién entra al armar grupos; esta
--  columna agrega el estado intermedio. Todas parten en 'present': la mesa de
--  control marca solo las excepciones. Es información interna del organizador.
-- ============================================================

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS attendance VARCHAR(10) NOT NULL DEFAULT 'present'
    CHECK (attendance IN ('present', 'pending', 'absent'));

UPDATE enrollments SET attendance = CASE WHEN checked_in THEN 'present' ELSE 'absent' END;
