/**
 * Reglas de elegibilidad por edad — mismos rangos que usa la Federación
 * Chilena de Tenis de Mesa (FECHITEME), temporada 2026, basados en el
 * formato ITTF: se compara por AÑO DE NACIMIENTO contra el año del torneo,
 * no por edad exacta al día de hoy — así un jugador no cambia de categoría
 * a mitad de temporada solo por cumplir años.
 * Fuente: https://fechiteme.cl/ns/wp-content/uploads/2026/01/Categorias_FECHITEME_2026.pdf
 *
 *   Minipeneca (U-9)    nacidos seasonYear-9  en adelante (sin techo)
 *   Peneca (U-11)       seasonYear-11 .. seasonYear-10
 *   Preinfantil (U-13)  seasonYear-13 .. seasonYear-12
 *   Infantil (U-15)     seasonYear-15 .. seasonYear-14
 *   Juvenil (U-19)      seasonYear-19 .. seasonYear-16
 *   U-23                seasonYear-23 .. seasonYear-20
 *   Máster N-M          seasonYear-M  .. seasonYear-N  (bandas de 5 años)
 *   Todo Competidor / Iniciación / Intermedio / "Otro" — sin restricción.
 */

export type BirthYearRange = {
  // Año de nacimiento MÁS CHICO permitido (= la persona más grande de la
  // categoría). null = sin piso.
  minBirthYear: number | null;
  // Año de nacimiento MÁS GRANDE permitido (= la persona más chica de la
  // categoría). null = sin techo.
  maxBirthYear: number | null;
};

// offset = "cuántos años antes del año del torneo nació el más grande /
// más chico posible de la categoría" — minOffset siempre es el número más
// alto (persona más grande = nació antes = resta más).
const YOUTH_OFFSETS: Record<string, { minOffset: number; maxOffset: number | null }> = {
  minipeneca: { minOffset: 9, maxOffset: null },
  peneca: { minOffset: 11, maxOffset: 10 },
  preinfantil: { minOffset: 13, maxOffset: 12 },
  infantil: { minOffset: 15, maxOffset: 14 },
  juvenil: { minOffset: 19, maxOffset: 16 },
  u23: { minOffset: 23, maxOffset: 20 },
};

// "30-34" / "30–34" (en dash) / "30 - 34" -> banda cerrada.
// "80+" / "80 y más" / "80 y mas" -> banda abierta hacia arriba (sin techo de edad).
// Cualquier otra cosa (ej. "Personalizado" con texto libre) -> no se pudo
// interpretar, se devuelve null y NO se aplica ninguna restricción — mejor
// no validar que bloquear mal a alguien por un formato que no reconocemos.
function parseMasterRange(categoryRange: string): { minAge: number; maxAge: number | null } | null {
  const cleaned = categoryRange.trim();

  const openMatch = cleaned.match(/^(\d{2,3})\s*(\+|y\s*m[aá]s)/i);
  if (openMatch) return { minAge: Number(openMatch[1]), maxAge: null };

  const rangeMatch = cleaned.match(/^(\d{2,3})\s*[-–]\s*(\d{2,3})/);
  if (rangeMatch) return { minAge: Number(rangeMatch[1]), maxAge: Number(rangeMatch[2]) };

  return null;
}

/**
 * Devuelve el rango de años de nacimiento permitido para una categoría en
 * la temporada de un torneo puntual, o null si esa categoría no tiene
 * restricción de edad (o no se pudo interpretar el rango, ej. un "Máster
 * Personalizado" con texto libre).
 */
export function getCategoryBirthYearRange(
  categoryType: string,
  categoryRange: string,
  seasonYear: number
): BirthYearRange | null {
  const key = categoryType.trim().toLowerCase();

  if (key === "master" || key === "máster") {
    const parsed = parseMasterRange(categoryRange);
    if (!parsed) return null;
    return {
      minBirthYear: parsed.maxAge === null ? null : seasonYear - parsed.maxAge,
      maxBirthYear: seasonYear - parsed.minAge,
    };
  }

  const offsets = YOUTH_OFFSETS[key];
  if (!offsets) return null;

  return {
    minBirthYear: seasonYear - offsets.minOffset,
    maxBirthYear: offsets.maxOffset === null ? null : seasonYear - offsets.maxOffset,
  };
}

export function isBirthYearInRange(birthYear: number, range: BirthYearRange): boolean {
  if (range.minBirthYear !== null && birthYear < range.minBirthYear) return false;
  if (range.maxBirthYear !== null && birthYear > range.maxBirthYear) return false;
  return true;
}
