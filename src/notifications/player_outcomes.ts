import DB from "../db/db_configuration";
import { NotificationsRepository } from "./notifications_repository";
import { PlayerRepository } from "../player/player_repository";

// Avisos de "cómo te fue" que antes no existían — el jugador tenía que
// entrar a mirar la tabla o la llave para enterarse:
//  - al terminar los grupos: si clasificaste a la llave o quedaste fuera,
//    con tu posición en el grupo;
//  - al terminar la categoría: tu posición final (campeón, podio, etc.).
// Nunca rompen el flujo que los llama: cualquier error se loguea y listo.

const pool = () => DB.getPool();
const notifications = () => new NotificationsRepository(pool());

async function categoryNames(idCategory: string) {
  const res = await pool().query<{
    id_tournament: string;
    tournament_name: string;
    category_type: string;
    category_range: string;
  }>(
    `SELECT t.id_tournament, t.tournament_name, tc.category_type, tc.category_range
     FROM tournament_categories tc JOIN tournaments t ON t.id_tournament = tc.id_tournament
     WHERE tc.id_category = $1`,
    [idCategory]
  );
  return res.rows[0] ?? null;
}

function label(n: { category_type: string; category_range: string }) {
  return [n.category_type, n.category_range === "General" ? "" : n.category_range].filter(Boolean).join(" ");
}

// Evita avisar dos veces lo mismo (ej. se deshace un resultado de la final y
// se vuelve a cargar: la categoría "termina" de nuevo).
async function alreadyNotified(idCategory: string, type: string): Promise<Set<string>> {
  const res = await pool().query<{ id_user: string }>(
    `SELECT DISTINCT id_user FROM notifications WHERE id_category = $1 AND type = $2`,
    [idCategory, type]
  );
  return new Set(res.rows.map((r) => r.id_user));
}

/** Tras generar la llave: a cada jugador de los grupos, si clasificó o no. */
export async function notifyGroupOutcome(idCategory: string, qualifiedIds: string[]): Promise<void> {
  try {
    const names = await categoryNames(idCategory);
    if (!names) return;
    const qualified = new Set(qualifiedIds);
    const done = await alreadyNotified(idCategory, "group_outcome");
    const res = await pool().query<{ id_user: string; position: number | null; group_name: string }>(
      `SELECT gs.id_user, gs.position, cg.group_name
       FROM group_standings gs JOIN category_groups cg ON cg.id_group = gs.id_group
       WHERE cg.id_category = $1`,
      [idCategory]
    );
    const repo = notifications();
    const cat = label(names);
    for (const r of res.rows) {
      if (done.has(r.id_user)) continue;
      const pos = r.position ? `${r.position}º del Grupo ${r.group_name}` : `Grupo ${r.group_name}`;
      const ok = qualified.has(r.id_user);
      await repo.create({
        idUser: r.id_user,
        type: "group_outcome",
        title: ok ? "¡Clasificaste a la llave!" : "Terminó tu fase de grupos",
        message: ok
          ? `Pasaste a la llave de ${cat} (${names.tournament_name}) como ${pos}. Mira contra quién te toca.`
          : `Quedaste ${pos} en ${cat} (${names.tournament_name}) y no alcanzaste a clasificar. ¡Gracias por jugar!`,
        idTournament: names.id_tournament,
        idCategory,
      });
    }
  } catch (err) {
    console.error("[notifyGroupOutcome]", err);
  }
}

/** Al terminar la categoría: a cada jugador, su posición final. */
export async function notifyFinalPositions(idCategory: string): Promise<void> {
  try {
    const names = await categoryNames(idCategory);
    if (!names) return;
    const { standings } = await new PlayerRepository().getCategoryStandings(names.id_tournament, idCategory);
    if (!standings.length) return;
    const done = await alreadyNotified(idCategory, "final_position");
    const repo = notifications();
    const cat = label(names);
    for (const s of standings as { id_user: string; position: number }[]) {
      if (done.has(s.id_user)) continue;
      const p = Number(s.position);
      const title =
        p === 1 ? "🏆 ¡Eres campeón!" : p === 2 ? "🥈 ¡Subcampeón!" : p === 3 ? "🥉 ¡Tercer lugar!" : `Terminaste en el lugar ${p}`;
      const message =
        p <= 3
          ? `Terminaste ${p}º en ${cat} (${names.tournament_name}). Queda guardado en tu perfil.`
          : `Terminó ${cat} (${names.tournament_name}): quedaste en el lugar ${p}. ¡Gracias por jugar!`;
      await repo.create({ idUser: s.id_user, type: "final_position", title, message, idTournament: names.id_tournament, idCategory });
    }
  } catch (err) {
    console.error("[notifyFinalPositions]", err);
  }
}
