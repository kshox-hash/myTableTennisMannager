-- ============================================================
--  052 — Frecuencia de cobro del club: mensual o semanal
--
--  club_dues pasaba el periodo como texto ('YYYY-MM', solo servía para
--  mensual). Se reemplaza por un rango de fechas real (period_start/
--  period_end) — mismo criterio que usan los sistemas de facturación
--  recurrente (Stripe, QuickBooks, etc.): un periodo es un rango de
--  fechas, no una etiqueta de texto, así semanal y mensual comparten la
--  misma columna sin inventar un formato distinto por frecuencia.
--  clubs.fee_frequency decide qué tan largo es un periodo.
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS fee_frequency VARCHAR(10) NOT NULL DEFAULT 'monthly'
    CHECK (fee_frequency IN ('monthly', 'weekly'));

ALTER TABLE club_dues
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE;

-- Todo lo que ya existe es mensual (period = 'YYYY-MM') — se rellenan las
-- fechas reales a partir de ese texto antes de exigir NOT NULL.
UPDATE club_dues
  SET period_start = to_date(period || '-01', 'YYYY-MM-DD'),
      period_end   = (to_date(period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' - INTERVAL '1 day')::date
  WHERE period_start IS NULL;

ALTER TABLE club_dues
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;

-- La llave única pasa de (club, socio, texto-de-periodo) a
-- (club, socio, fecha-ancla-del-periodo) — sirve igual para semanal o
-- mensual, sin tocar nada más.
ALTER TABLE club_dues DROP CONSTRAINT IF EXISTS club_dues_id_club_id_user_period_key;
ALTER TABLE club_dues
  ADD CONSTRAINT club_dues_id_club_id_user_period_start_key UNIQUE (id_club, id_user, period_start);

DROP INDEX IF EXISTS idx_club_dues_club_period;
CREATE INDEX IF NOT EXISTS idx_club_dues_club_period_start ON club_dues (id_club, period_start);

-- period_start/period_end reemplazan por completo al texto — ya no hace
-- falta guardar los dos.
ALTER TABLE club_dues DROP COLUMN IF EXISTS period;
