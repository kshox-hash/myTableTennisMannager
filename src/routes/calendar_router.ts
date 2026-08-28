import { Router } from "express";
import { authRequired } from "../middlewares/auth_required_middleware";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { CalendarRepository } from "../calendar/calendar_repository";
import { CalendarService } from "../calendar/calendar_service";
import { CalendarController } from "../calendar/calendar_controller";

const calendarRouter = Router();

const repo = new CalendarRepository();
const service = new CalendarService(repo);
const controller = new CalendarController(service);

// Única ruta del código que no pasaba por asyncHandler como todas las
// demás — Express 5 ya reenvía solo las promesas rechazadas de un handler
// async al middleware de errores, así que no era un bug real, pero
// conviene mantener el mismo patrón en todos lados.
calendarRouter.get("/my", authRequired, asyncHandler(controller.myEvents));

export default calendarRouter;
