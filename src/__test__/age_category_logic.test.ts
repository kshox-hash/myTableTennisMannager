import { getCategoryBirthYearRange, isBirthYearInRange } from "../age_category_logic";

// Temporada 2026 — mismos números que la tabla oficial de FECHITEME
// (Categorías Federadas 2026): Peneca U-11 = 2015-2016, Juvenil U-19 =
// 2007-2010, etc.
const SEASON = 2026;

describe("getCategoryBirthYearRange — categorías juveniles", () => {
  it("Minipeneca: sin techo, piso en 2017", () => {
    const range = getCategoryBirthYearRange("Minipeneca", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2017, maxBirthYear: null });
  });

  it("Peneca: 2015-2016", () => {
    const range = getCategoryBirthYearRange("Peneca", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2015, maxBirthYear: 2016 });
  });

  it("Preinfantil: 2013-2014", () => {
    const range = getCategoryBirthYearRange("Preinfantil", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2013, maxBirthYear: 2014 });
  });

  it("Infantil: 2011-2012", () => {
    const range = getCategoryBirthYearRange("Infantil", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2011, maxBirthYear: 2012 });
  });

  it("Juvenil: 2007-2010", () => {
    const range = getCategoryBirthYearRange("Juvenil", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2007, maxBirthYear: 2010 });
  });

  it("U23: 2003-2006 (insensible a mayúsculas)", () => {
    const range = getCategoryBirthYearRange("u23", "General", SEASON);
    expect(range).toEqual({ minBirthYear: 2003, maxBirthYear: 2006 });
  });
});

describe("getCategoryBirthYearRange — Máster", () => {
  it("banda cerrada con guion normal: 30-34", () => {
    const range = getCategoryBirthYearRange("Master", "30-34", SEASON);
    expect(range).toEqual({ minBirthYear: 1992, maxBirthYear: 1996 });
  });

  it("banda cerrada con en-dash (como ya la escribe el admin): 35–39", () => {
    const range = getCategoryBirthYearRange("Master", "35–39", SEASON);
    expect(range).toEqual({ minBirthYear: 1987, maxBirthYear: 1991 });
  });

  it("banda abierta: 80+", () => {
    const range = getCategoryBirthYearRange("Master", "80+", SEASON);
    expect(range).toEqual({ minBirthYear: null, maxBirthYear: 1946 });
  });

  it("banda abierta con texto: 80 y más", () => {
    const range = getCategoryBirthYearRange("Master", "80 y más", SEASON);
    expect(range).toEqual({ minBirthYear: null, maxBirthYear: 1946 });
  });

  it("rango libre que no se puede interpretar -> sin restricción", () => {
    const range = getCategoryBirthYearRange("Master", "Grupo especial", SEASON);
    expect(range).toBeNull();
  });
});

describe("getCategoryBirthYearRange — sin restricción", () => {
  it.each(["Todo Competidor", "Iniciación", "Intermedio", "Cualquier cosa"])(
    "%s no tiene rango de edad",
    (categoryType) => {
      expect(getCategoryBirthYearRange(categoryType, "General", SEASON)).toBeNull();
    }
  );
});

describe("isBirthYearInRange", () => {
  const juvenil = { minBirthYear: 2007, maxBirthYear: 2010 };

  it("dentro del rango", () => {
    expect(isBirthYearInRange(2008, juvenil)).toBe(true);
  });

  it("justo en los bordes", () => {
    expect(isBirthYearInRange(2007, juvenil)).toBe(true);
    expect(isBirthYearInRange(2010, juvenil)).toBe(true);
  });

  it("fuera del rango por muy grande o muy chico", () => {
    expect(isBirthYearInRange(2006, juvenil)).toBe(false);
    expect(isBirthYearInRange(2011, juvenil)).toBe(false);
  });

  it("rango sin techo (Minipeneca) acepta cualquier año reciente", () => {
    const minipeneca = { minBirthYear: 2017, maxBirthYear: null };
    expect(isBirthYearInRange(2020, minipeneca)).toBe(true);
    expect(isBirthYearInRange(2016, minipeneca)).toBe(false);
  });

  it("rango sin piso (Máster 80+) acepta cualquier año viejo", () => {
    const master80 = { minBirthYear: null, maxBirthYear: 1946 };
    expect(isBirthYearInRange(1930, master80)).toBe(true);
    expect(isBirthYearInRange(1947, master80)).toBe(false);
  });
});
