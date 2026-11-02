-- ============================================================
--  079 — Catálogo de clubes controlado por MyTTM
--
--  Los clubes dejan de crearse sueltos: los carga el superadmin, que
--  también les asigna su administrador. El jugador elige del catálogo o
--  manda una solicitud de club nuevo. Sirve además como registro para
--  torneos interclubes.
--   1) clubs.is_listed: el club aparece en el catálogo. Puede no tener
--      dueño todavía: en ese caso el jugador entra directo, sin solicitud.
--      Las filas viejas de texto libre siguen fuera (nadie las revisó).
--   2) club_requests: pedidos de club nuevo, que revisa el superadmin.
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS comuna    VARCHAR(80);

-- Los clubes con dueño ya estaban en el selector: siguen ahí. Si dos se
-- llaman igual entra uno solo, para no romper el índice único de abajo.
UPDATE clubs SET is_listed = TRUE
WHERE id_club IN (
  SELECT DISTINCT ON (LOWER(name)) id_club
  FROM clubs
  WHERE created_by IS NOT NULL
  ORDER BY LOWER(name), id_club
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_listed_name
  ON clubs (LOWER(name)) WHERE is_listed;

CREATE TABLE IF NOT EXISTS club_requests (
  id_request   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  comuna       VARCHAR(80),
  note         TEXT,
  requested_by UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  id_club      UUID REFERENCES clubs(id_club) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ,
  decided_by   UUID REFERENCES users(id_user) ON DELETE SET NULL
);

-- Un pedido abierto por persona, para no llenar la bandeja con repetidos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_requests_one_pending
  ON club_requests (requested_by) WHERE status = 'pending';
