-- ============================================================
--  029 — Revierte 026: se sacó la pantalla de administración
--  global de usuarios, así que esta columna quedó sin uso.
-- ============================================================
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
