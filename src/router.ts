import express from "express";
import tournamentRouter from "./routes/tournament_router";

import { validateBody } from "./middlewares/validate_body";
import { CreateTournamentSchema } from "./schemas/tournament.schema";

const path = "api";
const version = "v1"

export default (app : express.Express) => {
    
app.use(`/${path}/${version}/tournament`, validateBody(CreateTournamentSchema), tournamentRouter);

};

           