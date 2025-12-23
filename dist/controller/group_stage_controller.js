"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStageController = void 0;
class GroupStageController {
    constructor(service, repo) {
        this.service = service;
        this.repo = repo;
        // POST /group-stages  -> crear fase de grupos (distribución)
        this.createGroupStage = async (req, res) => {
            try {
                const { jugadores, jugadoresPorGrupo } = req.body;
                if (!Array.isArray(jugadores) || jugadores.length === 0) {
                    return res.status(400).json({ error: "jugadores debe ser un arreglo no vacío" });
                }
                if (jugadoresPorGrupo !== undefined && (typeof jugadoresPorGrupo !== "number" || jugadoresPorGrupo < 2)) {
                    return res.status(400).json({ error: "jugadoresPorGrupo debe ser un número >= 2" });
                }
                const groups = await this.service.createGroupStage(jugadores, jugadoresPorGrupo);
                return res.status(201).json({ ok: true, groups });
            }
            catch (err) {
                return res.status(400).json({ ok: false, error: err?.message ?? "Error creando grupos" });
            }
        };
        // GET /groups -> lista de grupos
        this.listGroups = async (_req, res) => {
            try {
                const groups = await this.repo.findAll();
                return res.json({ ok: true, groups });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error listando grupos" });
            }
        };
        // GET /groups/:id -> detalle de un grupo
        this.getGroup = async (req, res) => {
            try {
                const id = Number(req.params.id);
                if (Number.isNaN(id))
                    return res.status(400).json({ error: "id inválido" });
                const group = await this.repo.findById(id);
                if (!group)
                    return res.status(404).json({ error: "Grupo no encontrado" });
                return res.json({ ok: true, group });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error obteniendo grupo" });
            }
        };
        // GET /groups/:id/players -> jugadores del grupo
        this.getGroupPlayers = async (req, res) => {
            try {
                const id = Number(req.params.id);
                if (Number.isNaN(id))
                    return res.status(400).json({ error: "id inválido" });
                const group = await this.repo.findById(id);
                if (!group)
                    return res.status(404).json({ error: "Grupo no encontrado" });
                const players = await this.repo.getPlayers(id);
                return res.json({ ok: true, group, players });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error obteniendo jugadores" });
            }
        };
        // PATCH /groups/:id -> actualizar campos (solo numero en este repo)
        this.updateGroup = async (req, res) => {
            try {
                const id = Number(req.params.id);
                const { numero } = req.body;
                if (Number.isNaN(id))
                    return res.status(400).json({ error: "id inválido" });
                if (numero !== undefined && (typeof numero !== "number" || numero < 1)) {
                    return res.status(400).json({ error: "numero debe ser un número >= 1" });
                }
                const updated = await this.repo.update(id, { numero });
                if (!updated)
                    return res.status(404).json({ error: "Grupo no encontrado" });
                return res.json({ ok: true, group: updated });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error actualizando grupo" });
            }
        };
        // DELETE /groups/:id -> eliminar
        this.deleteGroup = async (req, res) => {
            try {
                const id = Number(req.params.id);
                if (Number.isNaN(id))
                    return res.status(400).json({ error: "id inválido" });
                const deleted = await this.repo.delete(id);
                if (!deleted)
                    return res.status(404).json({ error: "Grupo no encontrado" });
                return res.json({ ok: true });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error eliminando grupo" });
            }
        };
        // POST /groups/:id/players -> agregar jugador manualmente a un grupo
        this.addPlayer = async (req, res) => {
            try {
                const groupId = Number(req.params.id);
                const { playerId } = req.body;
                if (Number.isNaN(groupId))
                    return res.status(400).json({ error: "groupId inválido" });
                if (typeof playerId !== "number")
                    return res.status(400).json({ error: "playerId debe ser numérico" });
                const group = await this.repo.findById(groupId);
                if (!group)
                    return res.status(404).json({ error: "Grupo no encontrado" });
                await this.repo.addPlayer(groupId, playerId);
                return res.status(201).json({ ok: true });
            }
            catch (err) {
                return res.status(500).json({ ok: false, error: err?.message ?? "Error agregando jugador al grupo" });
            }
        };
    }
}
exports.GroupStageController = GroupStageController;
//# sourceMappingURL=group_stage_controller.js.map