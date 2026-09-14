-- ============================================================
--  049 — Clubes: ficha completa + solicitud de ingreso
--
--  `clubs` era una tabla mínima (id + nombre) que se autocreaba con
--  cualquier texto libre tipeado en "Club" (perfil de jugador/admin) — sin
--  curación, sin dueño, sin forma de controlar quién pertenece. Ahora un
--  admin puede crear un club "de verdad" (con dueño, imágenes, historia) y
--  los jugadores lo eligen de una lista y mandan una solicitud que ese
--  admin acepta o rechaza. Las filas viejas (creadas por texto libre, sin
--  created_by) NO aparecen en el selector nuevo — nadie las puede aprobar.
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS created_by        UUID REFERENCES users(id_user) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS header_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS crest_image_url   TEXT,
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS founded_date      DATE,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS club_join_requests (
  id_request   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_club      UUID NOT NULL REFERENCES clubs(id_club) ON DELETE CASCADE,
  id_user      UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ,
  decided_by   UUID REFERENCES users(id_user)
);

-- Un jugador solo puede tener UNA solicitud pendiente a la vez (para no
-- spamear admins ni dejar el flujo ambiguo sobre a qué club se está uniendo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_join_requests_one_pending
  ON club_join_requests (id_user) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_club_join_requests_club_pending
  ON club_join_requests (id_club, status);
