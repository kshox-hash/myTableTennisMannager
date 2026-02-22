import type { Express } from "express";
import tournamentRouter from "./routes/tournament_router";
import enrollmentsRouter from "./routes/enrollments_router";
import authRouter from "./routes/auth_router";
import userRouter from "./routes/user_router";
import calendarRouter from "./routes/calendar_router";
import locationsRoutes from "./routes/locations_routes";




const path = "api";
const version = "v1";

export default function registerRoutes(app: Express) {
  //  Auth (login/register)
  app.use(`/${path}/${version}/auth`, authRouter);

  // perfil 
  app.use(`/${path}/${version}/users`, userRouter);

  // Torneos
  app.use(`/${path}/${version}/tournament`, tournamentRouter);

  // Inscripciones
  app.use(`/${path}/${version}/enrollments`, enrollmentsRouter);

  // Calendario 
  app.use(`/${path}/${version}/calendar`, calendarRouter);
  
  //lcoatioons
  app.use("/api/locations", locationsRoutes);
}
