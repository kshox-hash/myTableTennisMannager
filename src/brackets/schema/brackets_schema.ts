import { z } from "zod";

export const generateGroupsSchema = z
  .object({
    best_of_sets: z.union([z.literal(3), z.literal(5), z.literal(7)]).optional(),
  })
  .strict();

const setScoreSchema = z.object({
  p1: z.number().int().min(0).max(99),
  p2: z.number().int().min(0).max(99),
});

export const matchResultSchema = z
  .object({
    winner_id: z.string().uuid("winner_id inválido"),
    sets_player1: z.number().int().min(0).max(7),
    sets_player2: z.number().int().min(0).max(7),
    walkover: z.boolean().optional(),
    set_scores: z.array(setScoreSchema).max(7).optional(),
  })
  .strict();

export const generateBracketSchema = z
  .object({
    best_of_sets: z.union([z.literal(3), z.literal(5), z.literal(7)]).optional(),
  })
  .strict();

export const updateGroupQualifiersSchema = z
  .object({
    qualifiers_per_group: z.number().int().min(1).max(4),
  })
  .strict();

export const setMatchRefereeSchema = z
  .object({
    referee_id: z.string().uuid("referee_id inválido").nullable(),
  })
  .strict();

export const setGroupsManualSchema = z
  .object({
    groups: z.array(z.array(z.string().uuid()).min(2).max(4)).min(1),
    best_of_sets: z.union([z.literal(3), z.literal(5), z.literal(7)]).optional(),
  })
  .strict();

export const addPlayerToGroupSchema = z
  .object({
    id_user: z.string().uuid("id_user inválido"),
  })
  .strict();

// Crear un grupo NUEVO manual, aparte de los que ya existen — para sumar
// jugadores que llegaron después del sorteo sin tocar los grupos que ya
// están jugando. A diferencia de los grupos automáticos (2 a 4, todos-
// contra-todos), un grupo manual puede arrancar vacío (0) y crecer a
// cualquier cantidad después, uno a la vez, vía POST /groups/:id/members —
// no tiene el tope de 4 que sí tienen los grupos automáticos.
export const createManualGroupSchema = z
  .object({
    member_user_ids: z.array(z.string().uuid()).max(200),
  })
  .strict();

// Postergar a un jugador YA sembrado en la ronda 1 a una pre-llave nueva
// (ronda 0), para liberar su lugar y poder sumar ahí a alguien que llegó
// tarde — mismo "crear una llave" que pidió el usuario, análogo a crear un
// grupo manual nuevo. Solo el id del jugador a postergar: el partido de
// ronda 1 y el cupo (1 o 2) se resuelven solos en el repositorio.
export const createBracketPreRoundMatchSchema = z
  .object({
    pull_user_id: z.string().uuid("pull_user_id inválido"),
  })
  .strict();

// Llenar el cupo vacío de una pre-llave manual ya creada — análogo a
// addPlayerToGroupSchema.
export const addPlayerToBracketMatchSchema = z
  .object({
    id_user: z.string().uuid("id_user inválido"),
  })
  .strict();

export const moveGroupMemberSchema = z
  .object({
    id_user: z.string().uuid("id_user inválido"),
    id_group_to: z.string().uuid("id_group_to inválido"),
  })
  .strict();

export type GenerateGroupsInput   = z.infer<typeof generateGroupsSchema>;
export type MatchResultInput      = z.infer<typeof matchResultSchema>;
export type GenerateBracketInput  = z.infer<typeof generateBracketSchema>;
export type UpdateGroupQualifiersInput = z.infer<typeof updateGroupQualifiersSchema>;
export type SetMatchRefereeInput = z.infer<typeof setMatchRefereeSchema>;
export type MoveGroupMemberBody = z.infer<typeof moveGroupMemberSchema>;
export type SetGroupsManualBody = z.infer<typeof setGroupsManualSchema>;
export type AddPlayerToGroupBody = z.infer<typeof addPlayerToGroupSchema>;
export type CreateManualGroupBody = z.infer<typeof createManualGroupSchema>;
export type CreateBracketPreRoundMatchBody = z.infer<typeof createBracketPreRoundMatchSchema>;
export type AddPlayerToBracketMatchBody = z.infer<typeof addPlayerToBracketMatchSchema>;
