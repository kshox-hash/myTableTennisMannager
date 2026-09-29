import { Router } from "express";
import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";
import { EnrollmentsController } from "../player/player_enrollment_controller";
import { EnrollmentsService } from "../player/player_enrollment_service";
import { EnrollmentsRepository } from "../player/player_enrollment_repository";

import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";

import { enrollmentSchema } from "../schema/enrollment_schema";

const enrollmentsRouter = Router();

const repo = new EnrollmentsRepository();
const service = new EnrollmentsService(repo);
const controller = new EnrollmentsController(service);

// SUBSCRIBE TO CATEGORY
enrollmentsRouter.post(
  "/subscribe",
  authRequired,
  validateBody(enrollmentSchema),
  asyncHandler(controller.subscribe)
);

// ANULAR MI INSCRIPCIÓN (jugador) — solo mientras la categoría siga en
// inscripciones: con los grupos armados sacar a alguien los rompería (mismo
// criterio que cuando lo saca el organizador). Se avisa al organizador.
enrollmentsRouter.post(
  "/unsubscribe",
  authRequired,
  validateBody(enrollmentSchema),
  asyncHandler(async (req, res) => {
    const pool = DB.getPool();
    const userId = req.user!.id_user;
    const { id_tournament, id_category } = req.body;
    const cat = await pool.query<{ phase: string; category_type: string; category_range: string; tournament_name: string; created_by: string }>(
      `SELECT c.phase, c.category_type, c.category_range, t.tournament_name, t.created_by
         FROM tournament_categories c JOIN tournaments t ON t.id_tournament = c.id_tournament
        WHERE c.id_category = $1 AND c.id_tournament = $2`,
      [id_category, id_tournament]
    );
    const c = cat.rows[0];
    if (!c) return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
    if (c.phase !== "enrollment") {
      return res.status(409).json({ ok: false, message: "Ya se armaron los grupos: habla con el organizador para darte de baja." });
    }
    const upd = await pool.query(
      `UPDATE enrollments SET status = 'cancelled'
        WHERE id_user = $1 AND id_tournament = $2 AND id_category = $3 AND status = 'active'
        RETURNING id_enrollment`,
      [userId, id_tournament, id_category]
    );
    if ((upd.rowCount ?? 0) === 0) return res.status(404).json({ ok: false, message: "No estás inscrito en esta categoría" });

    const who = await pool.query<{ name: string }>(
      `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email) AS name FROM users WHERE id_user = $1`,
      [userId]
    );
    const label = [c.category_type, c.category_range === "General" ? "" : c.category_range].join(" ").trim();
    if (c.created_by) {
      await new NotificationsRepository().create({
        idUser: c.created_by,
        type: "player_unenrolled",
        title: "Un jugador anuló su inscripción",
        message: `${who.rows[0]?.name ?? "Un jugador"} anuló su inscripción en ${label} (${c.tournament_name}).`,
        idTournament: id_tournament,
        idCategory: id_category,
      });
    }
    return res.json({ ok: true, data: { cancelled: true } });
  })
);

export default enrollmentsRouter;