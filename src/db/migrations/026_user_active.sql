-- ============================================================
--  026 — Cuentas activas/desactivadas
--  Permite a un admin desactivar una cuenta (walk-ins duplicados,
--  jugadores/organizadores que ya no participan) sin borrar su
--  historial. Una cuenta desactivada no puede loguearse.
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
