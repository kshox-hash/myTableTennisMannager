import { Router } from "express";
import { EnrollmentsController } from "../player/player_enrollment_controller";
import { EnrollmentsService } from "../player/player_enrollment_service";
import { EnrollmentsRepository } from "../player/player_enrollment_repository";

import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";

import { enrollmentSchema } from "../schema/enrollent_schema";

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

export default enrollmentsRouter;