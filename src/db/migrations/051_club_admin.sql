-- ============================================================
--  051 — Administración interna del club: cuotas, caja, plantel
--
--  Tres piezas independientes que pidió el admin del club:
--   1) Cuotas: monto fijo por club (clubs.monthly_fee) + estado
--      pagado/pendiente por jugador y periodo (mes) en club_dues.
--   2) Caja: libro simple de movimientos (ingreso/gasto) en
--      club_cash_movements — el saldo se calcula al leer, sumando.
--   3) Plantel seleccionado: subconjunto de los miembros del club,
--      marcado en club_selected_players — no los saca del listado
--      general de socios, es una marca aparte.
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS club_dues (
  id_due   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_club  UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  id_user  UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  period   VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  amount   NUMERIC(10,2) NOT NULL,
  paid     BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at  TIMESTAMPTZ,
  UNIQUE (id_club, id_user, period)
);
CREATE INDEX IF NOT EXISTS idx_club_dues_club_period ON club_dues (id_club, period);

CREATE TABLE IF NOT EXISTS club_cash_movements (
  id_movement  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_club      UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  type         VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  description  VARCHAR(200) NOT NULL,
  occurred_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by   UUID NOT NULL REFERENCES users(id_user),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_club_cash_club_date ON club_cash_movements (id_club, occurred_at DESC);

CREATE TABLE IF NOT EXISTS club_selected_players (
  id_club   UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  id_user   UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_club, id_user)
);
