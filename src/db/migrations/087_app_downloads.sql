-- Descargas de la app (APK de descarga directa, sin Play Store). Cada paso
-- por GET /api/v1/app/download queda registrado antes de redirigir al APK:
-- "web" = botón "Descarga para Android" de la página, "app" = actualización
-- desde dentro de la app. Lo muestra el panel de superusuario.
CREATE TABLE IF NOT EXISTS app_downloads (
  id_download BIGSERIAL PRIMARY KEY,
  source      VARCHAR(10) NOT NULL DEFAULT 'web',
  build       INT,
  user_agent  VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_downloads_created ON app_downloads (created_at DESC);
