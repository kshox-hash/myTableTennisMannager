export const BRACKETS_ERRORS = {
  NOT_ENOUGH_PLAYERS: "NOT_ENOUGH_PLAYERS",
  GROUPS_ALREADY_EXIST: "GROUPS_ALREADY_EXIST",
  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",
  MATCH_ALREADY_PLAYED: "MATCH_ALREADY_PLAYED",
  INVALID_WINNER: "INVALID_WINNER",
  INVALID_SET_COUNT: "INVALID_SET_COUNT",
  BRACKET_ALREADY_EXISTS: "BRACKET_ALREADY_EXISTS",
  BRACKET_NOT_FOUND: "BRACKET_NOT_FOUND",
  NOT_ENOUGH_QUALIFIERS: "NOT_ENOUGH_QUALIFIERS",
  MATCH_NOT_READY: "MATCH_NOT_READY",
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  GROUPS_LOCKED: "GROUPS_LOCKED",
  PLAYER_NOT_IN_GROUP: "PLAYER_NOT_IN_GROUP",
  SAME_GROUP: "SAME_GROUP",
  PLAYER_ALREADY_PLAYED: "PLAYER_ALREADY_PLAYED",
  SOURCE_GROUP_TOO_SMALL: "SOURCE_GROUP_TOO_SMALL",
  TARGET_GROUP_FULL: "TARGET_GROUP_FULL",
  MATCHES_ALREADY_PLAYED: "MATCHES_ALREADY_PLAYED",
  INVALID_GROUP_SIZE: "INVALID_GROUP_SIZE",
  DUPLICATE_PLAYER: "DUPLICATE_PLAYER",
  INVALID_PLAYER: "INVALID_PLAYER",
  PLAYERS_MISSING: "PLAYERS_MISSING",
  PLAYER_NOT_ENROLLED: "PLAYER_NOT_ENROLLED",
  ALREADY_IN_A_GROUP: "ALREADY_IN_A_GROUP",
  MATCH_NOT_PLAYED: "MATCH_NOT_PLAYED",
  CATEGORY_ALREADY_ADVANCED: "CATEGORY_ALREADY_ADVANCED",
  // El sorteo que se está confirmando ya no coincide con los clasificados
  // actuales (p.ej. cambiaron resultados de grupo entre previsualizar y
  // confirmar) — hay que volver a previsualizar.
  SEEDING_OUT_OF_DATE: "SEEDING_OUT_OF_DATE",
  // El orden de grupos que se está confirmando no coincide con los grupos
  // que arma el algoritmo ahora mismo (p.ej. cambió quién está inscrito
  // entre previsualizar el fixture y confirmarlo) — hay que volver a
  // previsualizar.
  GROUPS_OUT_OF_DATE: "GROUPS_OUT_OF_DATE",
} as const;

export type BracketsError = (typeof BRACKETS_ERRORS)[keyof typeof BRACKETS_ERRORS];

export type SetScore = { p1: number; p2: number };

// ───── GRUPOS ─────────────────────────────────────────────

export type GroupRow = {
  id_group: string;
  id_tournament: string;
  id_category: string;
  group_name: string;
  target_size: 2 | 3 | 4;
  sort_order: number;
  status: "draft" | "active" | "finished";
  group_kind: "normal" | "manual" | "playoff_two";
  qualifiers_per_group: number;
};

export type GroupMemberRow = {
  id_group: string;
  id_user: string;
  seed: number | null;
  assignment_type: "auto" | "manual";
  // Puesto del jugador dentro del grupo (1, 2, 3...) — null en filas viejas
  // de antes de que existiera esta columna.
  group_position: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  club_name: string | null;
};

export type GroupStandingRow = {
  id_group: string;
  id_user: string;
  played: number;
  won: number;
  lost: number;
  sets_for: number;
  sets_against: number;
  points_for: number;
  points_against: number;
  position: number | null;
  qualified_to_bracket: boolean;
  qualification_label: "first" | "second" | null;
};

export type GroupMatchRow = {
  id_match: string;
  id_group: string;
  id_tournament: string;
  id_category: string;
  stage: "group";
  round_number: number;
  match_number: number;
  best_of_sets: 3 | 5 | 7;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  sets_player1: number;
  sets_player2: number;
  status: "scheduled" | "played" | "walkover";
  source_note: "group_stage" | "two_player_group";
  table_number: number | null;
  played_table_number: number | null;
  set_scores: SetScore[] | null;
  referee_id: string | null;
};

export type CategoryGroupsView = {
  groups: Array<
    GroupRow & {
      members: GroupMemberRow[];
      standings: GroupStandingRow[];
      matches: GroupMatchRow[];
    }
  >;
};

export type MoveGroupMemberInput = {
  tournamentId: string;
  categoryId: string;
  userId: string;
  toGroupId: string;
};

// ───── PREVISUALIZACIÓN DEL FIXTURE (orden de juego de los grupos) ────

export type GroupsPreviewMember = {
  id_user: string;
  seed: number | null;
  group_position: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  ranking_points: number | null;
  ranking_position: number | null;
};

export type GroupsPreviewMatch = {
  match_number: number;
  player1_id: string;
  player2_id: string;
};

export type GroupsPreviewGroup = {
  group_name: string;
  sort_order: number; // orden de juego por defecto (GR-1=1, GR-2=2...) — se puede reordenar antes de confirmar
  target_size: 2 | 3 | 4;
  group_kind: "normal" | "manual" | "playoff_two";
  members: GroupsPreviewMember[];
  matches: GroupsPreviewMatch[];
};

export type GroupsPreview = {
  groups: GroupsPreviewGroup[];
};

// Orden de juego elegido por el admin: nombres de grupo (GR-1, GR-2, GR-3...)
// en el orden en que se van a jugar.
export type GroupOrderInput = string[];

// ───── CUADRO ELIMINATORIO (LLAVES) ────────────────────────

export type BracketMatchRow = {
  id_match: string;
  id_tournament: string;
  id_category: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  next_round: number | null;
  next_match_number: number | null;
  next_match_slot: 1 | 2 | null;
  winner_id: string | null;
  sets_player1: number;
  sets_player2: number;
  best_of_sets: 3 | 5 | 7;
  is_bye: boolean;
  status: "pending" | "ready" | "played" | "walkover" | "bye";
  played_at: string | null;
  set_scores: SetScore[] | null;
  table_number: number | null;
  played_table_number: number | null;
  referee_id: string | null;
  dead_slot: 1 | 2 | null;
  seed1: number | null;
  seed2: number | null;
};

export type BracketView = {
  bracket_size: number;
  total_rounds: number;
  rounds: Array<{
    round: number;
    matches: BracketMatchRow[];
  }>;
  // Pre-llave (ronda 0): aparte de `rounds` a propósito — el árbol de
  // conectores del frontend asume que cada ronda tiene la mitad de partidos
  // que la anterior, lo cual no es cierto entre la pre-llave y la ronda 1
  // (ver buildBracketWithPreRound). Se renderiza como una sección propia.
  pre_round?: BracketMatchRow[];
};

// ───── PREVISUALIZACIÓN DEL SORTEO ─────────────────────────

export type BracketQualifierRow = {
  id_user: string;
  seed: number; // orden de clasificación (1 = mejor) — antes del sorteo
  group_name: string | null; // null = pase directo (no salió de ningún grupo)
  qualification_label: "first" | "second" | null; // 1º o 2º del grupo — null si no aplica
  first_name: string | null;
  last_name: string | null;
  email: string;
};

export type BracketSlotRow = {
  position: number; // 1..bracket_size, orden final en el cuadro (ronda 1)
  match_number: number; // partido de la ronda 1 al que pertenece (2 slots por partido)
  id_user: string | null; // null = BYE
  seed: number; // semilla original de quien quedó en esta posición
  group_name: string | null; // de qué grupo clasificó (null = pase directo o BYE)
  qualification_label: "first" | "second" | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export type BracketPreview = {
  bracket_size: number;
  qualifiers: BracketQualifierRow[]; // lista ordenada por clasificación, sin sortear
  slots: BracketSlotRow[]; // resultado del sorteo, listo para confirmar
  // Pre-llave (ronda 0): solo viene si el número de clasificados no es una
  // potencia de 2 exacta — mismo shape que `slots` (2 filas por partido,
  // agrupadas por match_number), para no duplicar tipos. Ver
  // buildBracketWithPreRound en bracket_generation_logic.ts.
  pre_round?: BracketSlotRow[];
};

export type BracketSlotAssignmentInput = Array<{ player_id: string | null; seed: number }>;
