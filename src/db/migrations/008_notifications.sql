-- ============================================================
--  008 — Notificaciones (campana para admin y jugador)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id_notification UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
  type            VARCHAR(40) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  message         TEXT NOT NULL,
  id_tournament   UUID REFERENCES tournaments(id_tournament) ON DELETE CASCADE,
  id_category     UUID REFERENCES tournament_categories(id_category) ON DELETE CASCADE,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(id_user, is_read, created_at DESC);
