import { Router } from "express";
import DB from "../db/db_configuration";
import { sendPush } from "./push";
import { authRequired } from "../middlewares/auth_required_middleware";
import { asyncHandler } from "../middlewares/wrap_async_middleware";

// Seguir un campeonato sin jugarlo ("visita"): familiares, compañeros de
// club, fans. Ven grupos y resultados como cualquiera (eso ya era público) y
// además reciben un aviso en los momentos importantes:
//   - arrancó una categoría (ya están los grupos)
//   - salió la llave de una categoría
//   - hay campeón en una categoría
//   - el campeonato terminó / se canceló / cambió fecha, hora o lugar
//   - recordatorio el día antes
// No se avisa partido a partido: serían decenas de push por campeonato.
//
// Solo a seguidores que NO están inscritos en el campeonato (los inscritos
// ya reciben sus propios avisos, más detallados). Nunca rompe la acción que
// lo origina: los errores se loguean y listo.

const pool = () => DB.getPool();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guarda el aviso para los seguidores (sin repetir el mismo título en el
 * mismo campeonato/categoría) y lo manda como push. */
export async function notifyFollowers(input: {
  idTournament: string;
  idCategory?: string | null;
  title: string;
  message: string;
}): Promise<void> {
  try {
    const idCategory = input.idCategory ?? null;
    const res = await pool().query<{ id_user: string }>(
      `INSERT INTO notifications (id_user, type, title, message, id_tournament, id_category)
       SELECT f.id_user, 'followed_update', $3::text, $4::text, $1::uuid, $2::uuid
         FROM tournament_followers f
         JOIN users u ON u.id_user = f.id_user AND u.deleted_at IS NULL
        WHERE f.id_tournament = $1::uuid
          AND NOT EXISTS (
            SELECT 1 FROM enrollments e
             WHERE e.id_tournament = $1 AND e.id_user = f.id_user AND e.status = 'active')
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.id_user = f.id_user AND n.type = 'followed_update'
               AND n.id_tournament = $1 AND n.id_category IS NOT DISTINCT FROM $2::uuid
               AND n.title = $3::text)
       RETURNING id_user`,
      [input.idTournament, idCategory, input.title, input.message]
    );
    const ids = res.rows.map((r) => r.id_user);
    if (ids.length === 0) return;
    void sendPush(ids, {
      title: input.title,
      body: input.message,
      data: { type: "followed_update", id_tournament: input.idTournament, id_category: idCategory },
    });
  } catch (err) {
    console.error("[notifyFollowers]", err);
  }
}

async function categoryInfo(idCategory: string) {
  const r = await pool().query<{ id_tournament: string; tournament_name: string; category_type: string; category_range: string }>(
    `SELECT t.id_tournament, t.tournament_name, tc.category_type, tc.category_range
       FROM tournament_categories tc JOIN tournaments t ON t.id_tournament = tc.id_tournament
      WHERE tc.id_category = $1`,
    [idCategory]
  );
  const c = r.rows[0];
  if (!c) return null;
  const label = [c.category_type, c.category_range === "General" ? "" : c.category_range].filter(Boolean).join(" ");
  return { ...c, label };
}

/** Se armaron los grupos: la categoría empezó. */
export async function followersCategoryStarted(idCategory: string): Promise<void> {
  const c = await categoryInfo(idCategory).catch(() => null);
  if (!c) return;
  await notifyFollowers({
    idTournament: c.id_tournament,
    idCategory,
    title: `Empezó ${c.label}`,
    message: `Ya están los grupos de ${c.label} en ${c.tournament_name}. Sigue los resultados en vivo.`,
  });
}

/** Salió la llave (cuadro eliminatorio) de la categoría. */
export async function followersBracketReady(idCategory: string): Promise<void> {
  const c = await categoryInfo(idCategory).catch(() => null);
  if (!c) return;
  await notifyFollowers({
    idTournament: c.id_tournament,
    idCategory,
    title: `Llave de ${c.label}`,
    message: `Ya está la llave de ${c.label} en ${c.tournament_name}. Mira los cruces.`,
  });
}

/** Terminó la categoría: quién salió campeón. */
export async function followersChampion(idCategory: string, championId: string | null): Promise<void> {
  const c = await categoryInfo(idCategory).catch(() => null);
  if (!c) return;
  let name: string | null = null;
  if (championId) {
    const u = await pool()
      .query<{ name: string }>(
        `SELECT TRIM(CONCAT_WS(' ', first_name, last_name)) AS name FROM users WHERE id_user = $1`,
        [championId]
      )
      .catch(() => null);
    name = u?.rows[0]?.name || null;
  }
  await notifyFollowers({
    idTournament: c.id_tournament,
    idCategory,
    title: `🏆 Campeón de ${c.label}`,
    message: name
      ? `${name} ganó ${c.label} en ${c.tournament_name}. Mira el podio y la llave completa.`
      : `Terminó ${c.label} en ${c.tournament_name}. Mira el podio y la llave completa.`,
  });
}

// --- Rutas -----------------------------------------------------------------

export const followersRouter = Router();

/** ¿Sigo este campeonato? + cuántos lo siguen. */
followersRouter.get(
  "/:id/follow",
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ ok: false, message: "Campeonato inválido" });
    const r = await pool().query<{ following: boolean; followers: number }>(
      `SELECT EXISTS (SELECT 1 FROM tournament_followers WHERE id_tournament = $1 AND id_user = $2) AS following,
              (SELECT COUNT(*)::int FROM tournament_followers WHERE id_tournament = $1) AS followers`,
      [id, req.user!.id_user]
    );
    return res.json({ ok: true, data: r.rows[0] });
  })
);

/** Seguir (idempotente). */
followersRouter.post(
  "/:id/follow",
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ ok: false, message: "Campeonato inválido" });
    const t = await pool().query<{ status: string }>(`SELECT status FROM tournaments WHERE id_tournament = $1`, [id]);
    if (!t.rows[0]) return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
    await pool().query(
      `INSERT INTO tournament_followers (id_tournament, id_user) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, req.user!.id_user]
    );
    return res.json({ ok: true, data: { following: true } });
  })
);

/** Dejar de seguir. */
followersRouter.delete(
  "/:id/follow",
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ ok: false, message: "Campeonato inválido" });
    await pool().query(`DELETE FROM tournament_followers WHERE id_tournament = $1 AND id_user = $2`, [id, req.user!.id_user]);
    return res.json({ ok: true, data: { following: false } });
  })
);

/** Campeonatos que sigo (los más nuevos primero). */
followersRouter.get(
  "/me/following",
  authRequired,
  asyncHandler(async (req, res) => {
    const r = await pool().query(
      `SELECT t.id_tournament, t.tournament_name, t.event_date, t.status, t.address
         FROM tournament_followers f JOIN tournaments t ON t.id_tournament = f.id_tournament
        WHERE f.id_user = $1
        ORDER BY t.event_date DESC NULLS LAST, f.created_at DESC
        LIMIT 100`,
      [req.user!.id_user]
    );
    return res.json({ ok: true, data: r.rows });
  })
);
