-- Medio de pago de la inscripción: al marcarla como pagada en la mesa de
-- control, el organizador indica si fue en efectivo o por transferencia.
-- NULL = sin pagar, o pagada antes de que existiera este dato.
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IN ('cash', 'transfer'));
