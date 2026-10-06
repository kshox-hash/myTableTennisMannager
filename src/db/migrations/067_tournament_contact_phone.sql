-- Teléfono de contacto del campeonato (WhatsApp del organizador): el jugador
-- puede escribirle desde la app (llega tarde, no va, consultas).
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
