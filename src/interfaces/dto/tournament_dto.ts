export type TournamentCategoryDTO = {
  id_category?: string;
  category_name: string;
  gender: "male" | "female" | "mixed";
  inscription_price: number;
  quotas: number;
};

export type TournamentCreateDTO = {
  tournament_name: string;
  description?: string | null;
  location?: string | null;
  created_by: string;

  // ✅ NUEVO (para calendario)
  event_date: string;          // "YYYY-MM-DD"
  event_time?: string | null;  // "HH:MM" opcional

  categories?: TournamentCategoryDTO[];
};

export interface ITournament {
  id_tournament: string;
  tournament_name: string;
  description?: string | null;
  location?: string | null;
  created_by: string;

  // ✅ NUEVO
  event_date: string;
  event_time?: string | null;

  categories: TournamentCategoryDTO[];
}
