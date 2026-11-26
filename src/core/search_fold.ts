// Búsquedas sin distinguir mayúsculas, tildes (ñ = n) ni espacios de más,
// igual que los buscadores de la web y la app. Sin la extensión unaccent:
// translate() cubre las letras del español (mismo truco que user_repository).
const FOLD_FROM = "áéíóúüàèìòùâêîôûäëïöñçÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÑÇ";
const FOLD_TO = "aeiouuaeiouaeiouaeioncaeiouuaeiouaeiouaeionc";

/** Columna/expresión SQL plegada (comparar con LIKE contra foldLike(q)). */
export const foldSql = (expr: string): string =>
  `translate(lower(regexp_replace(${expr}, '\\s+', ' ', 'g')), '${FOLD_FROM}', '${FOLD_TO}')`;

/** Texto plegado en JS (mismo resultado que foldSql). */
export const foldText = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Parámetro para `foldSql(col) LIKE $n`: "%josé  pérez%" → "%jose%perez%" (palabras en orden, con lo que sea entre medio). */
export const foldLike = (q: string): string => {
  const words = foldText(q).replace(/[%_\\]/g, "").split(" ").filter(Boolean);
  return `%${words.join("%")}%`;
};
