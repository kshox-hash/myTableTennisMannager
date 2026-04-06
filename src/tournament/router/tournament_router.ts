import { Router } from "express";
import { AdminTournamentController } from "../admin/admin_tournament_controller";
import { AdminTournamentService } from "../admin/admin_tournament_service";
import { AdminTournamentRepository } from "../admin/admin_tournament_repository";

import { authRequired } from "../../middlewares/auth_required_middleware";
import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";

import { createTournamentSchema } from "../scheme/tournament_scheme";

const router = Router();

const repository = new AdminTournamentRepository();
const service = new AdminTournamentService(repository);
const controller = new AdminTournamentController(service);

// CREATE TOURNAMENT
// POST /api/v1/admin/create/tournament
router.post(
  "/admin/create/tournament",
  authRequired,
  validateBody(createTournamentSchema),
  asyncHandler(controller.adminCreateTournament)
);

// LIST ALL TOURNAMENTS (admin view)
// GET /api/v1/admin/tournaments?q=&region=
router.get(
  "/admin/tournaments",
  authRequired,
  asyncHandler(controller.adminListTournaments)
);

// MY TOURNAMENTS
// GET /api/v1/admin/get/tournaments/my?created_by=uuid
router.get(
  "/admin/get/tournaments/my",
  authRequired,
  asyncHandler(controller.adminGetMyTournaments)
);

// ENROLLMENTS
// GET /api/v1/admin/tournaments/:id_tournament/enrollments
router.get(
  "/admin/tournaments/:id_tournament/enrollments",
  authRequired,
  asyncHandler(controller.adminGetTournamentEnrollments)
);

// TOURNAMENT CATEGORIES WITH ENROLLED COUNT
// GET /api/v1/admin/tournaments/:id_tournament/categories
router.get(
  "/admin/tournaments/:id_tournament/categories",
  authRequired,
  asyncHandler(controller.adminGetTournamentCategories)
);

// PLAYERS BY CATEGORY
// GET /api/v1/admin/tournaments/:id_tournament/category/:id_category/players
router.get(
  "/admin/tournaments/:id_tournament/category/:id_category/players",
  authRequired,
  asyncHandler(controller.adminGetCategoryPlayers)
);

// REMOVE ENROLLMENT
// POST /api/v1/admin/tournaments/:id_tournament/enrollments/remove
router.post(
  "/admin/tournaments/:id_tournament/enrollments/remove",
  authRequired,
  asyncHandler(controller.adminRemoveEnrollment)
);

// REMOVE PLAYER FROM CATEGORY
// DELETE /api/v1/admin/tournaments/:id_tournament/category/:id_category/player/:id_user
router.delete(
  "/admin/tournaments/:id_tournament/category/:id_category/player/:id_user",
  authRequired,
  asyncHandler(controller.adminRemovePlayerFromCategory)
);

export default router;