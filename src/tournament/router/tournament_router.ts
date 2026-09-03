import { Router } from "express";
import { AdminTournamentController } from "../admin/admin_tournament_controller";
import { AdminTournamentService } from "../admin/admin_tournament_service";
import { AdminTournamentRepository } from "../admin/admin_tournament_repository";

import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";

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

// CANCEL TOURNAMENT (solo el organizador)
router.post(
  "/admin/tournaments/:id_tournament/cancel",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminCancelTournament)
);

// BITÁCORA DE ACTIVIDAD
router.get(
  "/admin/tournaments/:id_tournament/activity",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminGetActivity)
);

// ENROLLMENTS BY TOURNAMENT
router.get(
  "/admin/tournaments/:id_tournament/enrollments",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminGetTournamentEnrollments)
);

// CATEGORIES WITH ENROLLED COUNT
router.get(
  "/admin/tournaments/:id_tournament/categories",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminGetTournamentCategories)
);

// PLAYERS BY CATEGORY
router.get(
  "/admin/tournaments/:id_tournament/category/:id_category/players",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminGetCategoryPlayers)
);

// REMOVE ENROLLMENT (admin cancels)
router.post(
  "/admin/tournaments/:id_tournament/enrollments/remove",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.adminRemoveEnrollment)
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
