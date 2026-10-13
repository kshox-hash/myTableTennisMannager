-- ============================================================
--  070 — Cuotas flexibles del club
--
--  Antes: la cuota del club se le aplicaba a TODOS los socios y cada
--  periodo sin un "pagado" marcado contaba como deuda (hasta 35 meses
--  atrás); el jugador veía "Debes N meses" en su app. Ahora:
--   1) club_member_fees: la cuota es por socio — normal (la del club),
--      especial (monto propio), exento o en pausa. Sin fila = sin cobro
--      (los socios nuevos entran sin cobro hasta que el dueño lo active).
--      starts_on: desde cuándo se le cobra; lo anterior nunca cuenta.
--   2) club_payments: el dueño REGISTRA pagos (monto, cuántos periodos
--      cubre, método, nota, opcionalmente enlazado a un movimiento de
--      Caja). Las filas de club_dues de esos periodos quedan enlazadas al
--      pago y se borran con él (anular un pago deja esos periodos sin
--      registrar).
--   3) clubs.show_dues_to_members: el socio solo ve su historial de pagos
--      si el dueño lo activa (apagado por defecto). Nunca ve "deuda".
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS show_dues_to_members BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS club_member_fees (
  id_club        UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  id_user        UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  mode           VARCHAR(10) NOT NULL CHECK (mode IN ('standard', 'custom', 'exempt', 'paused')),
  custom_amount  NUMERIC(10,2) CHECK (custom_amount IS NULL OR custom_amount >= 0),
  starts_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_club, id_user)
);

CREATE TABLE IF NOT EXISTS club_payments (
  id_payment    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_club       UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  id_user       UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  periods       INT NOT NULL CHECK (periods BETWEEN 1 AND 24),
  first_period  DATE NOT NULL,
  method        VARCHAR(10) CHECK (method IS NULL OR method IN ('cash', 'transfer', 'other')),
  note          VARCHAR(200),
  paid_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  id_movement   UUID REFERENCES club_cash_movements(id_movement) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id_user) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_club_payments_member ON club_payments (id_club, id_user, paid_on DESC);

-- Cada periodo pagado queda enlazado a su pago. La FK se agrega al final,
-- después de crear los pagos históricos con estos mismos ids.
ALTER TABLE club_dues ADD COLUMN IF NOT EXISTS id_payment UUID;

-- Historial: cada cuota que ya estaba marcada pagada pasa a ser un pago de
-- un periodo (así el socio ve su "último pago" aunque sea de antes).
UPDATE club_dues SET id_payment = gen_random_uuid() WHERE paid AND id_payment IS NULL;

INSERT INTO club_payments (id_payment, id_club, id_user, amount, periods, first_period, paid_on, created_by, created_at)
SELECT d.id_payment, d.id_club, d.id_user, d.amount, 1, d.period_start,
       COALESCE(d.paid_at::date, d.period_start), c.created_by, COALESCE(d.paid_at, NOW())
FROM club_dues d
JOIN clubs c ON c.id_club = d.id_club
WHERE d.paid AND d.id_payment IS NOT NULL
ON CONFLICT (id_payment) DO NOTHING;

-- Las filas "pendiente" sueltas ya no significan nada (pendiente = sin
-- pago registrado): se limpian.
DELETE FROM club_dues WHERE NOT paid;

ALTER TABLE club_dues DROP CONSTRAINT IF EXISTS club_dues_id_payment_fkey;
ALTER TABLE club_dues
  ADD CONSTRAINT club_dues_id_payment_fkey
  FOREIGN KEY (id_payment) REFERENCES club_payments(id_payment) ON DELETE CASCADE;

-- Clubes que ya cobraban: sus socios actuales quedan con la cuota normal,
-- pero contando recién desde el periodo actual — la "deuda" acumulada
-- hacia atrás era solo falta de registro, no deuda real.
INSERT INTO club_member_fees (id_club, id_user, mode, starts_on)
SELECT u.id_club, u.id_user, 'standard',
       CASE WHEN c.fee_frequency = 'weekly' THEN date_trunc('week', NOW())::date
            ELSE date_trunc('month', NOW())::date END
FROM users u
JOIN clubs c ON c.id_club = u.id_club
WHERE c.monthly_fee IS NOT NULL
ON CONFLICT (id_club, id_user) DO NOTHING;
