-- Súper usuarios agregados desde el panel de Súper usuario (además de los
-- fijos de la variable de entorno SUPERADMIN_EMAILS, que no se pueden quitar
-- desde la web). Se guarda el email: igual que con la variable, cualquier
-- cuenta con ese email entra con rol efectivo "superadmin".
CREATE TABLE IF NOT EXISTS superadmins (
  email      TEXT PRIMARY KEY,
  added_by   UUID REFERENCES users(id_user) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
