import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";

// Recordatorio el día antes: cada 10 min busca los campeonatos activos que
// son MAÑANA (hora de Chile) y avisa una vez a cada inscrito ("Mañana juegas
// la Copa Primavera, 10:00 en Polideportivo San Miguel"). Solo entre las
// 10:00 y las 21:00 para no mandar pushes de noche. Se deduplica contra la
// tabla notifications (un reinicio del servidor no lo repite).
export function startTournamentReminderScheduler(intervalMs = 10 * 60_000) {
  const pool = DB.getPool();
  const notifications = new NotificationsRepository();

  const run = async () => {
    try {
      const hour = await pool.query<{ h: number }>(
        `SELECT EXTRACT(HOUR FROM now() AT TIME ZONE 'America/Santiago')::int AS h`
      );
      const h = hour.rows[0]?.h ?? 0;
      if (h < 10 || h >= 21) return;

      const pending = await pool.query<{
        id_user: string;
        id_tournament: string;
        tournament_name: string;
        event_time: string | null;
        address: string | null;
      }>(
        `SELECT DISTINCT e.id_user, t.id_tournament, t.tournament_name,
                to_char(t.event_time, 'HH24:MI') AS event_time, t.address
           FROM tournaments t
           JOIN enrollments e ON e.id_tournament = t.id_tournament
          WHERE t.status = 'active'
            AND t.event_date = (now() AT TIME ZONE 'America/Santiago')::date + 1
            AND NOT EXISTS (
              SELECT 1 FROM notifications n
               WHERE n.id_user = e.id_user AND n.id_tournament = t.id_tournament
                 AND n.type = 'tournament_reminder'
            )`
      );
      for (const r of pending.rows) {
        const when = [r.event_time ? `a las ${r.event_time}` : null, r.address ? `en ${r.address}` : null]
          .filter(Boolean)
          .join(" ");
        await notifications.create({
          idUser: r.id_user,
          type: "tournament_reminder",
          title: `Mañana juegas ${r.tournament_name}`,
          message: when ? `Te esperamos ${when}. ¡Llega con tiempo para calentar!` : "¡Llega con tiempo para calentar!",
          idTournament: r.id_tournament,
        });
      }
    } catch (e) {
      console.error("[TournamentReminderScheduler]", e);
    }
  };

  console.log("[TournamentReminderScheduler] iniciado — revisando cada 10 min");
  void run();
  setInterval(run, intervalMs);
}
