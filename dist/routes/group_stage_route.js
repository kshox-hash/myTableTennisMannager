"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const group_stage_repository_1 = require("../repositories/group_stage_repository");
const group_stage_services_1 = require("../services/group_stage_services");
const group_stage_controller_1 = require("../controller/group_stage_controller");
const router = express_1.default.Router();
const repo = new group_stage_repository_1.GroupStageRepository(undefined);
const service = new group_stage_services_1.GroupStageService(repo);
const controller = new group_stage_controller_1.GroupStageController(service, repo);
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
exports.default = router;
//# sourceMappingURL=group_stage_route.js.map