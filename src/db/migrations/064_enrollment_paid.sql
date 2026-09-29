-- ============================================================
--  064 — Pago de la inscripción
-- ============================================================
-- El organizador marca en la mesa de control quién pagó la inscripción del
-- torneo (antes solo existían las cuotas del club). El jugador lo ve como
-- "Inscripción pagada" en el detalle del campeonato.
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
