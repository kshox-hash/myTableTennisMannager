import DB from "../../db/db_configuration";
import { TablesRepository } from "../tables/tables_repository";
import { NotificationsRepository } from "../../notifications/notifications_repository";

// Aviso "prepárate" por la cola de mesas: cada 30s (mismo molde que
// table_schedule_scheduler.ts) recorre la cola real de despacho de cada
// torneo en juego y avisa a los dos jugadores cuando su partido queda
// 2° en la cola (falta un partido) o 1° (entra a la próxima mesa libre).
// Cada jugador recibe un solo aviso por partido — se deduplica contra la
// misma tabla notifications, así un reinicio del servidor no lo repite.
// La notificación de "¡Tu mesa está lista!" (assignTable) sigue igual.
const NOTICE_POSITIONS = 2;

export function startQueueNoticeScheduler(intervalMs = 30_000) {
  const pool = DB.getPool();
  const tablesRepo = new TablesRepository();
  const notifications = new NotificationsRepository();

  setInterval(async () => {
    try {
      const live = await pool.query<{ id_tournament: string }>(
        `SELECT DISTINCT t.id_tournament
           FROM tournaments t
           JOIN tournament_categories c ON c.id_tournament = t.id_tournament
          WHERE t.status = 'active' AND c.phase IN ('groups', 'bracket')`
      );

      for (const { id_tournament } of live.rows) {
        const queue = await tablesRepo.getDispatchQueue(id_tournament);
        for (const [index, m] of queue.slice(0, NOTICE_POSITIONS).entries()) {
          const sides = [
            { me: m.player1_id, rival: m.player2_name },
            { me: m.player2_id, rival: m.player1_name },
          ];
          for (const side of sides) {
            const already = await pool.query(
              `SELECT 1 FROM notifications WHERE id_user = $1 AND id_match = $2 AND type = 'match_up_soon' LIMIT 1`,
              [side.me, m.id_match]
            );
            if ((already.rowCount ?? 0) > 0) continue;

            const rival = side.rival ?? "tu rival";
            await notifications.create({
              idUser: side.me,
              type: "match_up_soon",
              title: index === 0 ? "¡Eres el próximo!" : "Prepárate, ya casi te toca",
              message:
                index === 0
                  ? `Tu partido contra ${rival} entra a la próxima mesa libre. Acércate a la zona de juego.`
                  : `Falta un partido para el tuyo contra ${rival}. Ve calentando.`,
              idTournament: id_tournament,
              idCategory: m.id_category,
              idMatch: m.id_match,
              matchType: m.match_type,
            });
          }
        }
      }
      // Fase de grupos por terminar: cuando a una categoría le quedan 2
      // partidos de grupo o menos, se avisa una vez a todos sus jugadores
      // (van a saber pronto si pasan a la llave y en qué cruce).
      const ending = await pool.query<{ id_tournament: string; id_category: string; category_label: string; left: number }>(
        `SELECT tc.id_tournament, tc.id_category,
                TRIM(tc.category_type || ' ' || COALESCE(NULLIF(tc.category_range, 'General'), '')) AS category_label,
                COUNT(*) FILTER (WHERE gm.status NOT IN ('played', 'walkover'))::int AS left
           FROM tournament_categories tc
           JOIN tournaments t ON t.id_tournament = tc.id_tournament AND t.status = 'active'
           JOIN category_groups cg ON cg.id_category = tc.id_category
           JOIN group_matches gm ON gm.id_group = cg.id_group
          WHERE tc.phase = 'groups'
          GROUP BY tc.id_tournament, tc.id_category, tc.category_type, tc.category_range
         HAVING COUNT(*) FILTER (WHERE gm.status NOT IN ('played', 'walkover')) BETWEEN 1 AND 2`
      );
      for (const c of ending.rows) {
        const players = await pool.query<{ id_user: string }>(
          `SELECT DISTINCT gm.id_user
             FROM group_members gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
            WHERE cg.id_category = $1
              AND NOT EXISTS (
                SELECT 1 FROM notifications n
                 WHERE n.id_user = gm.id_user AND n.id_category = $1 AND n.type = 'groups_ending'
              )`,
          [c.id_category]
        );
        for (const { id_user } of players.rows) {
          await notifications.create({
            idUser: id_user,
            type: "groups_ending",
            title: "La fase de grupos está por terminar",
            message:
              c.left === 1
                ? `Queda 1 partido para cerrar los grupos de ${c.category_label}. Pronto se arma la llave: revisa si clasificaste.`
                : `Quedan ${c.left} partidos para cerrar los grupos de ${c.category_label}. Pronto se arma la llave: revisa si clasificaste.`,
            idTournament: c.id_tournament,
            idCategory: c.id_category,
          });
        }
      }
    } catch (err) {
      console.error("[QueueNoticeScheduler] error:", err);
    }
  }, intervalMs);

  console.log(`[QueueNoticeScheduler] iniciado — revisando cada ${intervalMs / 1000}s`);
}
