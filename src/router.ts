import type { Express } from "express";

import enrollmentsRouter from "./enrollment/router/enrollment_router";
//AUTH
import authRouter from "./auth/router/auth_router"
import calendarRouter from "./routes/calendar_router";
//TOURNAMENT
import tournamentRouter from "./tournament/router/tournament_router";
const path = "api";
const version = "v1";

export default function registerRoutes(app: Express) {
  //AUTH
  app.use(`/${path}/${version}/auth`, authRouter);
  //TOURNAMENTS
  app.use(`/${path}/${version}/tournament`, tournamentRouter);

  // Inscripciones
  app.use(`/${path}/${version}/enrollments`, enrollmentsRouter);

  // Calendario 
  app.use(`/${path}/${version}/calendar`, calendarRouter);
  

}
