"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupStageService = void 0;
//import { Player } from "../model/player_model";
class GroupStageService {
    constructor(groupStageRepository) {
        this.groupStageRepository = groupStageRepository;
    }
    async createGroupStage(jugadores, jugadoresPorGrupo = 3) {
        if (!jugadores || jugadores.length === 0) {
            throw new Error("No hay jugadores para crear grupos");
        }
        // 1. ordenar jugadores por ranking (mejores primero)
        const rankingOrderedPlayers = [...jugadores].sort((a, b) => b.ranking - a.ranking);
        // 2. calcular cantidad de grupos base
        let groupAmount = Math.floor(rankingOrderedPlayers.length / jugadoresPorGrupo);
        let sobrantes = rankingOrderedPlayers.length % jugadoresPorGrupo;
        // si sobran 3, significa que cabe otro grupo completo
        if (sobrantes === 3) {
            groupAmount += 1;
            sobrantes = 0;
        }
        // 3. inicializar grupos vacíos
        const groups = Array.from({ length: groupAmount }, () => []);
        // 4. asignar cabezas de serie (los mejores N jugadores)
        for (let i = 0; i < groupAmount && i < rankingOrderedPlayers.length; i++) {
            groups[i].push(rankingOrderedPlayers[i]);
        }
        // 5. repartir el resto en serpenteo
        let index = 0;
        let direction = 1;
        // 🔴 ANTES:
        // for (let j = groupAmount; j < rankingOrderedPlayers.length; j++) {
        //   groups[index].push(rankingOrderedPlayers[j]);
        //   index += direction;
        //   if (index === groupAmount || index < 0) {
        //     direction *= -1;
        //     index += direction;
        //   }
        // }
        // 🟢 AHORA: paro antes de los sobrantes,
        // así no duplico jugadores al final (bug corregido).
        const limite = rankingOrderedPlayers.length - sobrantes;
        for (let j = groupAmount; j < limite; j++) {
            groups[index].push(rankingOrderedPlayers[j]);
            index += direction;
            if (index >= groupAmount || index < 0) {
                // corrección: uso >= en vez de === para no pasarme de largo
                direction *= -1;
                index += direction;
            }
        }
        // 6. manejar sobrantes (casos 1 o 2)
        // 🔴 ANTES: podía duplicar jugadores porque ya fueron repartidos arriba
        // 🟢 AHORA: como los excluí en el for, ahora sí los agrego acá sin duplicar
        if (sobrantes === 1) {
            const jugadorExtra = rankingOrderedPlayers[rankingOrderedPlayers.length - 1];
            groups[groupAmount - 1].push(jugadorExtra);
        }
        if (sobrantes === 2) {
            const jugadorExtra1 = rankingOrderedPlayers[rankingOrderedPlayers.length - 2];
            const jugadorExtra2 = rankingOrderedPlayers[rankingOrderedPlayers.length - 1];
            groups[groupAmount - 2].push(jugadorExtra1);
            groups[groupAmount - 1].push(jugadorExtra2);
        }
        // 7. Validar tamaño de grupos (no más de 2 con 2 o 4 jugadores)
        this.ajustarExcedentes(groups, jugadoresPorGrupo);
        // 8. Evitar que jugadores del mismo club coincidan
        this.balancearPorClub(groups);
        // 9. guardar en BD
        // 🔴 ANTES:
        // hacía await dentro de for → llamadas secuenciales = lentas
        // 🟢 AHORA: uso Promise.all para paralelizar
        await Promise.all(groups.map(async (group, g) => {
            const groupId = await this.groupStageRepository.create({
                numero: g + 1,
            });
            return Promise.all(group.map((jugador) => this.groupStageRepository.addPlayer(groupId, jugador.id)));
        }));
        return groups;
    }
    /**
     * Ajustar grupos para cumplir con las reglas de tamaño
     */
    ajustarExcedentes(grupos, jugadoresPorGrupo) {
        const maxGruposConExtra = 2;
        let gruposConDos = 0;
        let gruposConCuatro = 0;
        for (const grupo of grupos) {
            if (grupo.length < jugadoresPorGrupo)
                gruposConDos++;
            if (grupo.length > jugadoresPorGrupo)
                gruposConCuatro++;
        }
        if (gruposConDos > maxGruposConExtra ||
            gruposConCuatro > maxGruposConExtra) {
            throw new Error("Exceso de grupos desbalanceados. Ajusta la configuración.");
        }
    }
    /**
     * Balancear grupos para evitar jugadores del mismo club juntos
     */
    balancearPorClub(grupos) {
        for (let i = 0; i < grupos.length; i++) {
            const clubCount = new Map();
            for (const jugador of grupos[i]) {
                const count = (clubCount.get(jugador.club) || 0) + 1;
                clubCount.set(jugador.club, count);
                if (count > 1) {
                    // Intentar intercambiar con otro grupo
                    for (let j = 0; j < grupos.length; j++) {
                        if (i === j)
                            continue;
                        const conflictIndex = grupos[i].indexOf(jugador);
                        const swapCandidate = grupos[j].find((p) => p.club !== jugador.club);
                        if (swapCandidate) {
                            // Intercambiar jugadores
                            grupos[i][conflictIndex] = swapCandidate;
                            grupos[j][grupos[j].indexOf(swapCandidate)] = jugador;
                            break;
                        }
                    }
                }
            }
        }
    }
}
exports.GroupStageService = GroupStageService;
//# sourceMappingURL=group_stage_services.js.map