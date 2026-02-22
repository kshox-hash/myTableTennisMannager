import { Router } from "express";
import { AuthController } from "../auth/auth_controller";
import { AuthService } from "../auth/auth_service";
import { AuthRepository } from "../auth/auth_repository";
import { authRequired } from "../middlewares/auth_required";

const authRouter = Router();

const repo = new AuthRepository();
const service = new AuthService(repo);
const controller = new AuthController(service);

authRouter.post("/register", controller.register);
authRouter.post("/login", controller.login);
authRouter.get("/me", authRequired, controller.me);

export default authRouter;
