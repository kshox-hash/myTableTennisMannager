import { Router } from "express";
import { EnrollmentsController } from "../enrollments/enrollments_controller";
import { EnrollmentsService } from "../enrollments/enrollments_service";
import { EnrollmentsRepository } from "../enrollments/enrollments_repository";

const enrollmentsRouter = Router();

const repo = new EnrollmentsRepository();
const service = new EnrollmentsService(repo);
const controller = new EnrollmentsController(service);

enrollmentsRouter.post("/subscribe", controller.subscribe);

export default enrollmentsRouter;
