-- ============================================================
--  062 — Tokens de dispositivo para notificaciones push (FCM)
-- ============================================================
-- La app del celular registra aquí su token de Firebase Cloud Messaging al
-- iniciar sesión. Cada notificación que se guarda en `notifications` se
-- envía también como push a los tokens del usuario (ver push.ts). Un
-- mismo token pertenece a un solo usuario: si otro inicia sesión en ese
-- celular, el token se reasigna.
CREATE TABLE IF NOT EXISTS device_tokens (
  token       TEXT PRIMARY KEY,
  id_user     UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  platform    VARCHAR(10) NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(id_user);
