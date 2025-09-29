import express, {Router} from "express";
import { GroupStageRepository } from "../repositories/group_stage_repository";
import { GroupStageService } from "../services/group_stage_services";
import { GroupStageController } from "../controller/group_stage_controller";

const router : Router= express.Router();

  const repo = new GroupStageRepository(undefined as any);
  const service = new GroupStageService(repo);
  const controller = new GroupStageController(service, repo);

  // Distribuir jugadores en grupos (fase de grupos)
  router.post("/group-stages", controller.createGroupStage);

  // CRUD básico de grupos
  router.get("/groups", controller.listGroups);
  router.get("/groups/:id", controller.getGroup);
  router.get("/groups/:id/players", controller.getGroupPlayers);
  router.patch("/groups/:id", controller.updateGroup);
  router.delete("/groups/:id", controller.deleteGroup);

  // Agregar jugador manualmente a un grupo existente
  router.post("/groups/:id/players", controller.addPlayer);

  export default router;