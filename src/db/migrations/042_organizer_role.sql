-- ============================================================
--  042 — Rol de coorganizador (organizer vs viewer)
-- ============================================================
-- Antes cualquier coorganizador invitado tenía exactamente los mismos
-- permisos que el dueño del torneo -- no había forma de invitar a alguien
-- (ej. un juez general) que solo necesita REVISAR el proceso (inscritos,
-- rankings, grupos, llave, mesas, actividad) sin poder tocar nada, salvo
-- reordenar cabezas de serie/sembrado, que sí puede hacer.
--
-- 'organizer' (default, compatible con las filas ya existentes): mismos
-- permisos de siempre, todo lo que puede hacer el dueño salvo invitar/sacar
-- gente y transferir el torneo.
-- 'viewer': solo lectura en todas las rutas de admin, más la excepción de
-- guardar el orden de sembrado (ver require_tournament_ownership_middleware
-- y seeding_router.ts).
ALTER TABLE tournament_organizers
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'organizer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournament_organizers_role_check'
  ) THEN
    ALTER TABLE tournament_organizers
      ADD CONSTRAINT tournament_organizers_role_check
      CHECK (role IN ('organizer', 'viewer'));
  END IF;
END $$;
