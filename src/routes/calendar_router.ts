import { Router } from "express";
import { authRequired } from "../middlewares/auth_required";
import { CalendarRepository } from "../calendar/calendar_repository";
import { CalendarService } from "../calendar/calendar_service";
import { CalendarController } from "../calendar/calendar_controller";

const calendarRouter = Router();

const repo = new CalendarRepository();
const service = new CalendarService(repo);
const controller = new CalendarController(service);

calendarRouter.get("/my", authRequired, controller.myEvents);

export default calendarRouter;
