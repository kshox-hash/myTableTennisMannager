import express, { Router, Request, Response } from "express";
import { AuthService } from "../services/auth_service";
import {AuthRepository} from "../repositories/auth_repository"
import { AuthController } from "../controller/auth_controller";
import { connectDB } from "../db/db_configuration";

const db = connectDB();
const repo = new AuthRepository(db)
const service = new AuthService(repo)
const authController = new AuthController(service, repo)
const router : Router = express.Router();

router.post("/auth/signup", () => console.log("nacho"));
//router.post("/auth/signin", controller.signup);
//router.post("/auth/login", controller.signup);

export default router;
