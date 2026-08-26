import { Router } from "express";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { validateBody } from "../middlewares/validate_body_middleware";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { UserRepository } from "../users/user_repository";
import { UserService } from "../users/user_service";
import { UserController } from "../users/user_controller";
import { updateProfileSchema, quickCreatePlayerSchema } from "../users/schema/user_schema";

const userRouter = Router();

const repo = new UserRepository();
const service = new UserService(repo);
const controller = new UserController(service);

// GET /api/v1/users/me
userRouter.get("/me", authRequired, asyncHandler(controller.me));

// GET /api/v1/users/me/stats
userRouter.get("/me/stats", authRequired, asyncHandler(controller.stats));

// GET /api/v1/users/admin/search?q= — admin busca jugadores para inscribirlos manualmente
userRouter.get(
  "/admin/search",
  authRequired,
  requireRole("admin"),
  asyncHandler(controller.adminSearchPlayers)
);

// POST /api/v1/users/admin/quick-create — crea un jugador sin cuenta (walk-in) para inscribirlo
userRouter.post(
  "/admin/quick-create",
  authRequired,
  requireRole("admin"),
  validateBody(quickCreatePlayerSchema),
  asyncHandler(controller.adminQuickCreatePlayer)
);

// GET /api/v1/users/:id_user/profile
userRouter.get("/:id_user/profile", authRequired, asyncHandler(controller.publicProfile));

// GET /api/v1/users/:id_user/public-card — sin auth, para las páginas públicas del sitio
userRouter.get("/:id_user/public-card", asyncHandler(controller.publicCard));

// PATCH /api/v1/users/me
userRouter.patch(
  "/me",
  authRequired,
  validateBody(updateProfileSchema),
  asyncHandler(controller.updateMe)
);

export default userRouter;
