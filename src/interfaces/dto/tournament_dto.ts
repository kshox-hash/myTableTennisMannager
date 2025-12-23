// Una categoría de campeonato
export interface TournamentCategoryDTO {
  id_category?: string;
  category_name: string;
  gender: "male" | "female";
  inscription_price: number;
  quotas : number;
}

// Lo que recibe el backend para crear un campeonato
export interface TournamentCreateDTO {
  tournament_name?: string;
  description?: string;
  categories: TournamentCategoryDTO[];
  location?: string;
  created_by: string;
}

// Lo que devuelve el backend (campeonato + categorías)
export interface ITournament extends TournamentCreateDTO {
  id_tournament: string;
}
