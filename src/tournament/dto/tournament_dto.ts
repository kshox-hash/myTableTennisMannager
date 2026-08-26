export const ADMIN_TOURNAMENT_ERRORS = {
  MISSING_CREATE_FIELDS: "MISSING_CREATE_FIELDS",
  MISSING_CREATED_BY: "MISSING_CREATED_BY",
  MISSING_TOURNAMENT_ID: "MISSING_TOURNAMENT_ID",
  MISSING_REMOVE_ENROLLMENT_FIELDS: "MISSING_REMOVE_ENROLLMENT_FIELDS",
  MISSING_CHECKIN_FIELDS: "MISSING_CHECKIN_FIELDS",
  MISSING_CATEGORY_PARAMS: "MISSING_CATEGORY_PARAMS",
  MISSING_REMOVE_PLAYER_PARAMS: "MISSING_REMOVE_PLAYER_PARAMS",
  ENROLLMENT_NOT_FOUND: "ENROLLMENT_NOT_FOUND",
  PLAYER_ALREADY_ENROLLED: "PLAYER_ALREADY_ENROLLED",
  INVALID_IDS: "INVALID_IDS",
  TOURNAMENT_NOT_FOUND: "TOURNAMENT_NOT_FOUND",
  NOT_TOURNAMENT_OWNER: "NOT_TOURNAMENT_OWNER",
  TOURNAMENT_ALREADY_CANCELLED: "TOURNAMENT_ALREADY_CANCELLED",
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",
  CATEGORY_ALREADY_STARTED: "CATEGORY_ALREADY_STARTED",
} as const;

export type QualificationType = "group" | "direct_advance" | "late_entry";

export type AdminAddPlayerInput = {
  userId: string;
  tournamentId: string;
  categoryId: string;
  qualificationType: QualificationType;
};

export type AdminAddPlayerResult = {
  id_enrollment: string;
  id_user: string;
  id_tournament: string;
  id_category: string;
  qualification_type: QualificationType;
  status: string;
};

export type AdminTournamentError =
  typeof ADMIN_TOURNAMENT_ERRORS[keyof typeof ADMIN_TOURNAMENT_ERRORS];

// DTO ADMIN TOURNAMENTS

export type TournamentCategoryDTO = {
  id_category?: string;
  category_type: string;
  category_range: string;
  gender: "male" | "female" | "mixed";
  inscription_price: number;
  quotas: number | null;
  status?: string;
  phase?: string;
  qualifiers_per_group?: number;
  // Solo se completan en el listado para jugador (findAll con userId)
  enrolled_count?: number;
  is_enrolled?: boolean;
};

export type TournamentCreateDTO = {
  tournament_name: string;
  description?: string | null;

  created_by: string;

  allow_mixed: boolean;
  allow_olympic: boolean;

  address?: string | null;
  region?: string | null;

  event_date: string;
  event_time?: string | null;

  categories?: TournamentCategoryDTO[];
};

export type TournamentUpdateDTO = {
  tournament_name?: string;
  description?: string | null;

  address?: string | null;
  region?: string | null;

  event_date?: string;
  event_time?: string | null;

  categories?: TournamentCategoryDTO[];
};

export interface ITournament {
  id_tournament: string;
  tournament_name: string;
  description: string | null;

  created_by: string;

  allow_mixed: boolean;
  allow_olympic: boolean;

  address: string | null;
  region: string | null;

  event_date: string;
  event_time: string | null;

  categories: TournamentCategoryDTO[];
}

export type AdminTournamentRow = {
  id_tournament: string;
  tournament_name: string;
  description: string | null;

  created_by: string;

  allow_mixed: boolean;
  allow_olympic: boolean;

  address: string | null;
  region: string | null;

  event_date: string | null;
  event_time: string | null;
  created_at: string;
  status: "active" | "cancelled";
};

// Enrollments list row
export type EnrollmentRow = {
  id_user: string;
  id_category: string;
  status: "active" | "cancelled";
  enrolled_at: string;
  checked_in: boolean;

  email: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;

  id_club: string | null;
  club_name: string | null;

  category_type: string;
  category_range: string;
  category_gender: "male" | "female" | "mixed";
};

// Pagination
export type PaginatedTournamentResult = {
  data: ITournament[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

// Categories summary for admin tournament view
export type AdminCategoryRow = {
  id_category: string;
  category_type: string;
  category_range: string;
  gender: "male" | "female" | "mixed";
  inscription_price: number;
  quotas: number | null;
  status: string;
  enrolled_count: number;
  qualifiers_per_group: number;
};

// Players by category for admin
export type AdminCategoryPlayerRow = {
  id_enrollment: string;
  id_user: string;
  first_name: string | null;
  last_name: string | null;
  email: string;

  id_club: string | null;
  club_name: string | null;

  gender: string | null;
  enrolled_at: string;
};