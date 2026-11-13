import { Router } from "express";
import DB from "../../db/db_configuration";
import { AdminTournamentController } from "../admin/admin_tournament_controller";
import { AdminTournamentService } from "../admin/admin_tournament_service";
import { AdminTournamentRepository } from "../admin/admin_tournament_repository";

import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { finishTournament } from "../admin/finish_tournament";
import { saveTournamentSchedule } from "../admin/tournament_schedule";
import { z } from "zod";
import { RANKED_PLAYERS_CTE, RankingRepository } from "../../ranking/ranking_repository";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
import { closeAbsentMatchesAfterAttendance } from "../../brackets/absent_close";
import { listUndoPoints, previewUndo, undoToPoint } from "../../activity/undo_history";

import {
  createTournamentSchema,
  updateTournamentSchema,
  adminAddPlayerSchema,
} from "../scheme/tournament_scheme";

const router = Router();

const repository = new AdminTournamentRepository();
const service = new AdminTournamentService(repository);
const controller = new AdminTournamentController(service);

// LIST TOURNAMENTS (player / jugador) — solo authRequired, sin requireRole
router.get(
  "/player/tournaments",
  authRequired,
  asyncHandler(controller.adminListTournaments)
);

// UN TORNEO PUNTUAL (player / jugador) — ej. tocar un evento del calendario
router.get(
  "/player/tournaments/:id_tournament",
  authRequired,
  asyncHandler(controller.getTournamentById)
);

// CREATE TOURNAMENT
router.post(
  "/admin/create/tournament",
  authRequired,
  requireRole("admin"),
  validateBody(createTournamentSchema),
  asyncHandler(controller.adminCreateTournament)
);

// LIST ALL TOURNAMENTS
router.get(
  "/admin/tournaments",
  authRequired,
  requireRole("admin"),
  asyncHandler(controller.adminListTournaments)
);

// MY STATS (perfil de organizador) — antes de /my para que no lo tape ningún patrón
router.get(
  "/admin/get/tournaments/my/stats",
  authRequired,
  requireRole("admin"),
  asyncHandler(controller.adminGetMyStats)
);

// MY TOURNAMENTS
router.get(
  "/admin/get/tournaments/my",
  authRequired,
  requireRole("admin"),
  asyncHandler(controller.adminGetMyTournaments)
);

// UPDATE TOURNAMENT (solo el organizador)
router.patch(
  "/admin/tournaments/:id_tournament",
  authRequired,
  requireRole("admin"),
  validateBody(updateTournamentSchema),
  requireTournamentOwnership(),
  asyncHandler(controller.adminUpdateTournament)
);

// FINALIZAR CAMPEONATO en cualquier momento (solo el organizador): cierra
// las categorías abiertas (sin podio), borra los partidos pendientes y avisa.
router.post(
  "/admin/tournaments/:id_tournament/finish",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const r = await finishTournament(String(req.params.id_tournament), req.user!.id_user);
    if (!r.ok) return res.status(r.status).json({ ok: false, message: r.message });
    return res.json({ ok: true, data: { categories: r.categories, cancelled_matches: r.cancelledMatches } });
  })
);

// RANKING DEL CAMPEONATO: a qué ranking del organizador suma. Los rankings
// son del dueño del campeonato (created_by), aunque lo cambie un co-organizador.
const rankingRepo = new RankingRepository();

router.get(
  "/admin/tournaments/:id_tournament/ranking",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const r = await DB.getPool().query(
      `SELECT t.created_by, t.id_ranking, t.is_ranked, rk.name AS ranking_name,
              (EXISTS (SELECT 1 FROM tournament_categories tc WHERE tc.id_tournament = t.id_tournament)
               AND NOT EXISTS (SELECT 1 FROM tournament_categories tc WHERE tc.id_tournament = t.id_tournament AND tc.phase <> 'finished')) AS finished
       FROM tournaments t
       LEFT JOIN rankings rk ON rk.id_ranking = t.id_ranking
       WHERE t.id_tournament = $1`,
      [req.params.id_tournament]
    );
    const t = r.rows[0];
    if (!t) return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
    const rankings = await rankingRepo.listOwnerRankings(t.created_by);
    return res.json({
      ok: true,
      data: { id_ranking: t.id_ranking, ranking_name: t.ranking_name, is_ranked: t.is_ranked, finished: t.finished, rankings },
    });
  })
);

const rankingChoiceSchema = z.object({
  mode: z.enum(["new", "existing", "none"]),
  name: z.string().trim().min(1).max(80).optional(),
  id_ranking: z.string().uuid().optional(),
});

// Visibilidad del campeonato (público / interno / privado), editable en
// cualquier momento — también con el campeonato empezado (antes había que
// cambiarlo directo en la base).
const visibilitySchema = z.object({ visibility: z.enum(["public", "internal", "private"]) });

router.patch(
  "/admin/tournaments/:id_tournament/visibility",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(visibilitySchema),
  asyncHandler(async (req, res) => {
    const { visibility } = req.body as z.infer<typeof visibilitySchema>;
    const r = await DB.getPool().query(
      `UPDATE tournaments SET visibility = $2 WHERE id_tournament = $1 RETURNING visibility`,
      [String(req.params.id_tournament), visibility]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
    return res.json({ ok: true, data: { visibility: r.rows[0].visibility } });
  })
);

router.post(
  "/admin/tournaments/:id_tournament/ranking",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(rankingChoiceSchema),
  asyncHandler(async (req, res) => {
    const { mode, name, id_ranking } = req.body as z.infer<typeof rankingChoiceSchema>;
    const id = String(req.params.id_tournament);
    const owner = await DB.getPool().query(`SELECT created_by, id_ranking FROM tournaments WHERE id_tournament = $1`, [id]);
    const createdBy: string | undefined = owner.rows[0]?.created_by;
    const previousRanking: string | null = owner.rows[0]?.id_ranking ?? null;
    if (!createdBy) return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });

    let rankingId: string | null = null;
    if (mode === "new") {
      if (!name) return res.status(400).json({ ok: false, message: "Falta el nombre del ranking" });
      // Dos rankings con el mismo nombre no se distinguen en la lista.
      const taken = (await rankingRepo.listOwnerRankings(createdBy)).some(
        (r) => r.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (taken) {
        return res.status(409).json({ ok: false, message: "Ya tienes un ranking con ese nombre: elígelo en \"Sumar a un ranking que ya tengo\"" });
      }
      rankingId = await rankingRepo.createRanking(createdBy, name);
    } else if (mode === "existing") {
      const r = id_ranking ? await rankingRepo.getRanking(id_ranking) : null;
      if (!r || r.id_owner !== createdBy) return res.status(400).json({ ok: false, message: "Ese ranking no es de este organizador" });
      rankingId = r.id_ranking;
    }
    // "none": no suma a ningún ranking (tampoco al general de la plataforma).
    await DB.getPool().query(`UPDATE tournaments SET id_ranking = $2, is_ranked = $3 WHERE id_tournament = $1`, [
      id,
      rankingId,
      mode !== "none",
    ]);
    // Historial del ranking (ver migración 094): se saca del anterior y se suma al nuevo.
    if (previousRanking !== rankingId) {
      if (previousRanking) {
        await DB.getPool().query(
          `INSERT INTO ranking_log (id_ranking, id_tournament, action, id_user) VALUES ($1, $2, 'removed', $3)`,
          [previousRanking, id, req.user!.id_user]
        );
      }
      if (rankingId) {
        await DB.getPool().query(
          `INSERT INTO ranking_log (id_ranking, id_tournament, action, id_user) VALUES ($1, $2, 'added', $3)`,
          [rankingId, id, req.user!.id_user]
        );
      }
    }
    return res.json({ ok: true, data: { id_ranking: rankingId, is_ranked: mode !== "none" } });
  })
);

// DÍAS DEL CAMPEONATO: día y hora de cada categoría (+ horas por jornada).
const scheduleSchema = z
  .object({
    day_hours: z.number().int().min(1).max(16).optional(),
    categories: z
      .array(
        z.object({
          id_category: z.string().uuid(),
          play_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
          start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
        })
      )
      .max(100),
  })
  .strict();
router.put(
  "/admin/tournaments/:id_tournament/schedule",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(scheduleSchema),
  asyncHandler(async (req, res) => {
    const r = await saveTournamentSchedule(String(req.params.id_tournament), req.body.day_hours, req.body.categories);
    if (!r.ok) return res.status(r.status).json({ ok: false, message: r.message });
    return res.json({ ok: true, data: { end_date: r.end_date } });
  })
);

// CANCEL TOURNAMENT (solo el organizador)
router.post(
  "/admin/tournaments/:id_tournament/cancel",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminCancelTournament)
);

// DELETE TOURNAMENT (borrado real en cascada, solo el organizador) — usado
// puntualmente para limpieza de datos de prueba; no tiene botón en la UI.
router.delete(
  "/admin/tournaments/:id_tournament",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminDeleteTournament)
);

// BITÁCORA DE ACTIVIDAD
router.get(
  "/admin/tournaments/:id_tournament/activity",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(controller.adminGetActivity)
);

// HISTORIAL PARA DESHACER (Actividad, como un Ctrl+Z)
router.get(
  "/admin/tournaments/:id_tournament/history",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(async (req, res) => {
    const rows = await listUndoPoints(req.params.id_tournament as string);
    res.json({ ok: true, data: rows });
  })
);

// Antes de confirmar: cuántos resultados se perderían (también los de árbitros).
router.get(
  "/admin/tournaments/:id_tournament/history/:id_point/preview",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const result = await previewUndo(req.params.id_tournament as string, req.params.id_point as string);
    if (!result.ok) return res.status(404).json({ ok: false, message: "Ese cambio ya no está en el historial." });
    res.json({ ok: true, data: { lostResults: result.lostResults, gainedResults: result.gainedResults } });
  })
);

router.post(
  "/admin/tournaments/:id_tournament/history/:id_point/undo",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const result = await undoToPoint(req.params.id_tournament as string, req.params.id_point as string, req.user!.id_user);
    if (!result.ok) {
      return res.status(404).json({ ok: false, message: "Ese cambio ya no está en el historial (quizás ya se deshizo)." });
    }
    res.json({ ok: true, data: result });
  })
);

// ENROLLMENTS BY TOURNAMENT
router.get(
  "/admin/tournaments/:id_tournament/enrollments",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(controller.adminGetTournamentEnrollments)
);

// CATEGORIES WITH ENROLLED COUNT
router.get(
  "/admin/tournaments/:id_tournament/categories",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(controller.adminGetTournamentCategories)
);

// PLAYERS BY CATEGORY
router.get(
  "/admin/tournaments/:id_tournament/category/:id_category/players",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(controller.adminGetCategoryPlayers)
);

// UPDATE CATEGORY PRIORITY (cola de orden entre categorías, flechas arriba/abajo)
router.patch(
  "/admin/tournaments/:id_tournament/category/:id_category/priority",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminUpdateCategoryPriority)
);

// CERRAR/REABRIR INSCRIPCIONES DE UNA CATEGORÍA (también lo que desbloquea
// la pestaña Sembrado, ver CategoryWorkspace.tsx en el frontend)
router.patch(
  "/admin/tournaments/:id_tournament/category/:id_category/status",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminUpdateCategoryStatus)
);

// "EMPEZAR CAMPEONATO" / CANCELAR SEMBRADO — bloquea o desbloquea el botón,
// persiste en el servidor (sobrevive recargar la página).
router.patch(
  "/admin/tournaments/:id_tournament/category/:id_category/seeding-in-progress",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminSetSeedingInProgress)
);

// REMOVE ENROLLMENT (admin cancels)
router.post(
  "/admin/tournaments/:id_tournament/enrollments/remove",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminRemoveEnrollment)
);

// POSICIÓN EN EL RANKING GENERAL DE LOS INSCRITOS — aparte de la lista porque
// suma los puntos de toda la plataforma, y la lista se recarga seguido.
router.get(
  "/admin/tournaments/:id_tournament/enrollments/ranks",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const r = await DB.getPool().query(
      `WITH ranked_players AS (${RANKED_PLAYERS_CTE})
       SELECT DISTINCT e.id_user, rp.ranking_position
       FROM enrollments e
       JOIN ranked_players rp ON rp.id_user = e.id_user
       WHERE e.id_tournament = $1 AND e.status = 'active'`,
      [req.params.id_tournament]
    );
    return res.json({ ok: true, data: r.rows });
  })
);

const attendanceSchema = z.object({
  id_user: z.string().uuid(),
  id_category: z.string().uuid(),
  attendance: z.enum(["present", "pending", "absent"]),
});

// ASISTENCIA DEL INSCRITO. Se cambia en cualquier fase: con la categoría ya
// empezada es solo un aviso y no toca grupos ni partidos. Antes de armar
// grupos, "absent" deja al jugador fuera (checked_in = false).
router.post(
  "/admin/tournaments/:id_tournament/enrollments/attendance",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const p = attendanceSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos" });
    const r = await DB.getPool().query(
      `UPDATE enrollments e
          SET attendance = $4::varchar,
              checked_in = CASE WHEN c.phase = 'enrollment' THEN $4::varchar <> 'absent' ELSE e.checked_in END
         FROM tournament_categories c
        WHERE c.id_category = e.id_category
          AND e.id_tournament = $1 AND e.id_user = $2 AND e.id_category = $3 AND e.status = 'active'
        RETURNING e.id_enrollment`,
      [req.params.id_tournament, p.data.id_user, p.data.id_category, p.data.attendance]
    );
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ ok: false, message: "No se encontró inscripción activa" });
    // Con los grupos en juego, "No vino" puede ser lo último que faltaba para
    // cerrar su grupo: sus partidos pasan a W.O. y clasifican los que jugaron.
    if (p.data.attendance === "absent") {
      await closeAbsentMatchesAfterAttendance(req.params.id_tournament, p.data.id_category, p.data.id_user);
    }
    return res.json({ ok: true });
  })
);

const editEnrolledPlayerSchema = z.object({
  id_user: z.string().uuid(),
  id_category: z.string().uuid(),
  id_club: z.string().uuid().nullable(),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// EDITAR UN INSCRITO. Sin cuenta: sus datos son del organizador, se corrigen
// directo. Con cuenta: solo por qué club juega en esta categoría (el club es de
// palabra); su perfil y su sello de verificado no se tocan.
router.patch(
  "/admin/tournaments/:id_tournament/enrollments/player",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const p = editEnrolledPlayerSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos" });
    const { id_user, id_category, id_club, first_name, last_name, birth_date } = p.data;
    const pool = DB.getPool();

    const found = await pool.query<{ email: string; first_name: string | null }>(
      `SELECT u.email, u.first_name
       FROM enrollments e JOIN users u ON u.id_user = e.id_user
       WHERE e.id_tournament = $1 AND e.id_category = $2 AND e.id_user = $3 AND e.status = 'active'`,
      [req.params.id_tournament, id_category, id_user]
    );
    if (found.rowCount === 0) return res.status(404).json({ ok: false, message: "No se encontró inscripción activa" });
    if (id_club) {
      const club = await pool.query(`SELECT 1 FROM clubs WHERE id_club = $1 AND is_listed`, [id_club]);
      if (club.rowCount === 0) return res.status(404).json({ ok: false, message: "Club no encontrado" });
    }

    if (/^sin-registro\+[0-9a-f-]+@myttm\.local$/i.test(found.rows[0].email)) {
      await pool.query(
        `UPDATE users SET first_name = $2, last_name = $3, birth_date = $4, id_club = $5 WHERE id_user = $1`,
        [id_user, first_name ?? found.rows[0].first_name, last_name ?? null, birth_date ?? null, id_club]
      );
    } else {
      await pool.query(
        `UPDATE enrollments SET club_override = $4
         WHERE id_tournament = $1 AND id_category = $2 AND id_user = $3`,
        [req.params.id_tournament, id_category, id_user, id_club]
      );
    }
    return res.json({ ok: true });
  })
);

// MARCAR PAGO DE LA INSCRIPCIÓN (admin, en cualquier fase: se paga en la
// mesa de control y puede ser con el torneo ya empezado)
router.post(
  "/admin/tournaments/:id_tournament/enrollments/paid",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const { id_user, id_category, paid, payment_method } = req.body ?? {};
    if (typeof id_user !== "string" || typeof id_category !== "string" || typeof paid !== "boolean") {
      return res.status(400).json({ ok: false, message: "Faltan campos: id_user, id_category, paid" });
    }
    // Medio de pago (opcional): efectivo o transferencia. Al quitar el pago se borra.
    if (payment_method != null && payment_method !== "cash" && payment_method !== "transfer") {
      return res.status(400).json({ ok: false, message: "payment_method debe ser 'cash' o 'transfer'" });
    }
    const method = paid ? (payment_method ?? null) : null;
    const r = await DB.getPool().query(
      `UPDATE enrollments SET paid = $4, paid_at = CASE WHEN $4 THEN now() ELSE NULL END, payment_method = $5
        WHERE id_tournament = $1 AND id_user = $2 AND id_category = $3 AND status = 'active'
        RETURNING id_enrollment`,
      [req.params.id_tournament, id_user, id_category, paid, method]
    );
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ ok: false, message: "No se encontró inscripción activa" });
    return res.json({ ok: true, data: { paid, payment_method: method } });
  })
);

// SET CHECK-IN (admin marca presente/ausente antes de generar grupos)
router.post(
  "/admin/tournaments/:id_tournament/enrollments/check-in",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminSetCheckIn)
);

// ADMIN ADD PLAYER TO CATEGORY (fuera de inscripción normal)
// POST /api/v1/tournament/admin/tournaments/:id_tournament/category/:id_category/players
router.post(
  "/admin/tournaments/:id_tournament/category/:id_category/players",
  authRequired,
  requireRole("admin"),
  validateBody(adminAddPlayerSchema),
  requireTournamentOwnership(),
  asyncHandler(controller.adminAddPlayer)
);

// REMOVE PLAYER FROM CATEGORY
router.delete(
  "/admin/tournaments/:id_tournament/category/:id_category/player/:id_user",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminRemovePlayerFromCategory)
);

export default router;
