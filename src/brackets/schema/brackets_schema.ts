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
