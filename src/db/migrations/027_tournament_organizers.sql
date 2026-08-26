-- ============================================================
--  027 — Coorganizadores de torneo
--  Permite al dueño de un torneo (tournaments.created_by) invitar
--  a otras cuentas admin a co-manejar ese torneo puntual (editar,
--  cancelar) sin transferir la propiedad.
-- ============================================================
CREATE TABLE IF NOT EXISTS tournament_organizers (
  id_tournament UUID NOT NULL REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_user       UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  invited_by    UUID NOT NULL REFERENCES users(id_user),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_tournament, id_user)
);
