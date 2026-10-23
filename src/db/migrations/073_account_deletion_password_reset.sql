-- ============================================================
--  073 — Eliminar cuenta y recuperar contraseña
--
--  Eliminar cuenta (exigido por Google Play): la fila del usuario NO se
--  borra — sus partidos, llaves y rankings son también de sus rivales —
--  sino que se anonimiza (sin email, nombre, foto ni datos personales) y
--  se marca con deleted_at. authRequired rechaza los tokens de una cuenta
--  eliminada.
--
--  Recuperar contraseña: un código de 6 dígitos por email, guardado
--  hasheado, que vence a los 15 minutos y admite 5 intentos. Uno vigente
--  por usuario (pedir otro reemplaza al anterior).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id_user    UUID        PRIMARY KEY REFERENCES users(id_user) ON DELETE CASCADE,
  code_hash  TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
