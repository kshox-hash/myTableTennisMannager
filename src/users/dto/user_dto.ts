export type UserProfileDB = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  role: string;
  id_club: string | null;
  club_name: string | null;
  birth_date: string | null;
  country: string | null;
  id_document: string | null;
  category: string | null;
  dominant_hand: string | null;
  created_at: string;
  // Si el admin decidió mostrar su ranking privado ("Mi Ranking") también
  // en su página pública de organizador ("Comunidad") — false por defecto,
  // no cambia nada para quien no lo prende a propósito.
  public_ranking_enabled: boolean;
};

export type UserSearchRow = {
  id_user: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  club_name: string | null;
};

export type PlayerStatsDB = {
  id_user: string;
  matches_played: number;
  matches_won: number;
  matches_lost: number;
  sets_won: number;
  sets_lost: number;
  updated_at: string;
};
