-- ============================================================
--  100 — A quién se le mandó el acceso de la prueba gratis
--
--  La cuenta de prueba es nueva (demo-<nombre>@myttm.cl); el acceso se manda
--  al correo que escribe el súper usuario (puede ser de alguien con cuenta).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_sent_to TEXT;
