-- ============================================================
--  059 — Índices de rendimiento
--
--  Detectados con la simulación de producción (scripts/simulate_production.ts):
--  claves foráneas que se consultan seguido y no tenían índice (Postgres no
--  crea índice solo por declarar la FK), y los dos schedulers que corren
--  cada 30 s recorriendo tablas enteras (tournament_categories tuvo 25.740
--  seq scans en la simulación). Todos IF NOT EXISTS: re-ejecutar es seguro.
-- ============================================================

-- Llave / grupos de una categoría (workspace del torneo, vistas públicas)
CREATE INDEX IF NOT EXISTS idx_bracket_matches_category ON bracket_matches (id_category);
CREATE INDEX IF NOT EXISTS idx_category_groups_category ON category_groups (id_category);

-- Estadísticas / historial por jugador
CREATE INDEX IF NOT EXISTS idx_group_standings_user ON group_standings (id_user);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_winner ON bracket_matches (winner_id);
CREATE INDEX IF NOT EXISTS idx_group_matches_winner ON group_matches (winner_id);

-- Torneos del organizador (Panel, perfil, stats, comunidad)
CREATE INDEX IF NOT EXISTS idx_tournaments_created_by ON tournaments (created_by);
CREATE INDEX IF NOT EXISTS idx_tournament_organizers_user ON tournament_organizers (id_user);

-- Clubes: socios, cuotas, plantel
CREATE INDEX IF NOT EXISTS idx_users_club ON users (id_club);
CREATE INDEX IF NOT EXISTS idx_club_dues_user ON club_dues (id_user);
CREATE INDEX IF NOT EXISTS idx_club_selected_players_user ON club_selected_players (id_user);

-- Notificaciones por torneo (ON DELETE CASCADE al borrar un torneo)
CREATE INDEX IF NOT EXISTS idx_notifications_tournament ON notifications (id_tournament);

-- PhaseScheduler (cada 30 s): solo categorías con arranque programado
CREATE INDEX IF NOT EXISTS idx_categories_scheduled_start
  ON tournament_categories (phase)
  WHERE groups_start_mode = 'scheduled' OR bracket_start_mode = 'scheduled';

-- TableScheduleScheduler (cada 30 s): partidos programados aún sin mesa
CREATE INDEX IF NOT EXISTS idx_group_matches_due_schedule
  ON group_matches (scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL AND table_number IS NULL AND status = 'scheduled';
