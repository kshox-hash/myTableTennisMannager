import { Router } from "express";
import { AuthController } from "../auth_controller";
import { AuthService } from "../auth_service";
import { AuthRepository } from "../auth_repository";

import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRateLimit } from "../../middlewares/rate_limit_middleware";

import { signInSchema, signUpSchema } from "../schema/auth_schema";

const router = Router();

const repository = new AuthRepository();
const service = new AuthService(repository);
const controller = new AuthController(service);

// SIGN UP
router.post(
  "/sign-up",
  authRateLimit,
  validateBody(signUpSchema),
  asyncHandler(controller.signUp)
);

// SIGN IN
router.post(
  "/sign-in",
  authRateLimit,
  validateBody(signInSchema),
  asyncHandler(controller.signIn)
);

export default router;