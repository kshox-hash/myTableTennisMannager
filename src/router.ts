import type { Express } from "express";

import authRouter        from "./auth/router/auth_router";
import tournamentRouter  from "./tournament/router/tournament_router";
import enrollmentsRouter from "./enrollment/router/enrollment_router";
import calendarRouter    from "./routes/calendar_router";
import userRouter        from "./routes/user_router";
import bracketsRouter    from "./brackets/router/brackets_router";
import phaseRouter       from "./tournament/phases/tournament_phase_router";
import dashboardRouter   from "./tournament/dashboard/tournament_dashboard_router";
import tablesRouter      from "./tournament/tables/tables_router";
import scheduleRouter    from "./tournament/schedule/schedule_router";
import publicTournamentRouter from "./tournament/public/public_tournament_router";
import playerRouter      from "./player/player_router";
import matchesRouter    from "./brackets/matches/matches_router";
import seedingRouter    from "./brackets/seeding/seeding_router";
import notificationsRouter from "./notifications/notifications_router";
import rankingRouter        from "./ranking/ranking_router";
import organizersRouter     from "./tournament/organizers/tournament_organizers_router";

import { errorMiddleware } from "./middlewares/error_middleware";
import { startPhaseScheduler } from "./tournament/phases/phase_scheduler";

const path    = "api";
const version = "v1";

export default function registerRoutes(app: Express) {
  app.use(`/${path}/${version}/auth`,        authRouter);
  app.use(`/${path}/${version}/tournament`,  tournamentRouter);
  app.use(`/${path}/${version}/enrollments`, enrollmentsRouter);
  app.use(`/${path}/${version}/calendar`,    calendarRouter);
  app.use(`/${path}/${version}/users`,       userRouter);
  app.use(`/${path}/${version}/bracket`,     bracketsRouter);
  app.use(`/${path}/${version}/tournament`,  phaseRouter);
  app.use(`/${path}/${version}/tournament`,  dashboardRouter);
  app.use(`/${path}/${version}/tournament`,  tablesRouter);
  app.use(`/${path}/${version}/tournament`,  scheduleRouter);
  app.use(`/${path}/${version}/tournament`,  publicTournamentRouter);
  app.use(`/${path}/${version}/player`,      playerRouter);
  app.use(`/${path}/${version}/bracket`,     matchesRouter);
  app.use(`/${path}/${version}/bracket`,     seedingRouter);
  app.use(`/${path}/${version}/notifications`, notificationsRouter);
  app.use(`/${path}/${version}/ranking`,     rankingRouter);
  app.use(`/${path}/${version}/tournament`,  organizersRouter);

  // Scheduler: revisa cada 30s si hay torneos programados para iniciar
  startPhaseScheduler();

  // Debe ir después de todas las rutas
  app.use(errorMiddleware);
}
