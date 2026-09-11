-- Login con Google: las cuentas creadas por ese camino no tienen contraseña
-- propia (no la eligen, no la sabemos), así que password_hash deja de ser
-- obligatorio. google_sub es el identificador estable que manda Google en el
-- token (payload.sub) — único por cuenta de Google, se usa para encontrar al
-- usuario en logins siguientes sin depender del email (que en teoría podría
-- cambiar del lado de Google, aunque es raro).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
