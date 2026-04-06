import { Router } from "express";
import { authRequired } from "../middlewares/auth_required_middleware";
import { UserRepository } from "../users/user_repository";
import { UserService } from "../users/user_service";
import { UserController } from "../users/user_controller";

const userRouter = Router();

const repo = new UserRepository();
const service = new UserService(repo);
const controller = new UserController(service);

userRouter.get("/me", authRequired, controller.me);

export default userRouter;
