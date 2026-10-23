import { Router } from "express";
import { AuthController } from "../auth_controller";
import { AuthService } from "../auth_service";
import { AuthRepository } from "../auth_repository";

import { validateBody } from "../../middlewares/validate_body_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRateLimit, passwordResetRateLimit } from "../../middlewares/rate_limit_middleware";

import { signInSchema, signUpSchema, googleAuthSchema, forgotPasswordSchema, resetPasswordSchema } from "../schema/auth_schema";

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

// GOOGLE (login y registro en un solo paso — ver auth_service.loginWithGoogle)
router.post(
  "/google",
  authRateLimit,
  validateBody(googleAuthSchema),
  asyncHandler(controller.google)
);

// RECUPERAR CONTRASEÑA — 1) pedir el código por email, 2) usarlo
router.post(
  "/password/forgot",
  passwordResetRateLimit,
  validateBody(forgotPasswordSchema),
  asyncHandler(controller.forgotPassword)
);

router.post(
  "/password/reset",
  authRateLimit,
  validateBody(resetPasswordSchema),
  asyncHandler(controller.resetPassword)
);

export default router;