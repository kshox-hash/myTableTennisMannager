// src/routes/brackets_routes.ts
import { Router } from "express";
import { BracketController } from "../brackets/brackets_controller";

const r = Router();
const c = new BracketController();

// generar llaves desde una categoría
r.post("/tournaments/:tournamentId/categories/:categoryId/generate-bracket", c.generateBracket);

// reportar resultado y avanzar
r.post("/brackets/:bracketId/matches/:matchId/result", c.reportResult);

export default r;
