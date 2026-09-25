-- ============================================================
--  058 — Región del jugador + regiones de torneo normalizadas
--
--  "Campeonatos nuevos" (Inicio del jugador) muestra solo torneos de
--  la región del jugador: alguien de Santiago no va a jugar a
--  Concepción. Para eso:
--   1) users.region — misma lista oficial que usa el formulario de
--      torneo (CHILE_REGIONS en el front). NULL = no la eligió aún.
--   2) tournaments.region tenía valores sueltos de antes del selector
--      ("Región Metropolitana", "Santiago", comunas…) que nunca
--      coincidirían con "Metropolitana de Santiago". Se normalizan a la
--      región oficial. Lo que no se reconoce queda como estaba.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS region VARCHAR(40);

UPDATE tournaments SET region = CASE
  WHEN unaccent_lower IN (
    'region metropolitana', 'metropolitana', 'rm', 'santiago', 'santiago centro',
    'providencia', 'nunoa', 'las condes', 'vitacura', 'lo barnechea', 'la reina',
    'penalolen', 'macul', 'la florida', 'puente alto', 'san miguel', 'la cisterna',
    'maipu', 'cerrillos', 'estacion central', 'quinta normal', 'lo prado', 'pudahuel',
    'cerro navia', 'renca', 'quilicura', 'huechuraba', 'conchali', 'independencia',
    'recoleta', 'la granja', 'san joaquin', 'pedro aguirre cerda', 'lo espejo',
    'el bosque', 'la pintana', 'san ramon', 'san bernardo', 'colina', 'lampa',
    'buin', 'paine', 'talagante', 'penaflor', 'melipilla', 'padre hurtado', 'pirque',
    'san jose de maipo', 'calera de tango'
  ) THEN 'Metropolitana de Santiago'
  WHEN unaccent_lower IN ('valparaiso', 'vina del mar', 'quilpue', 'villa alemana', 'con con', 'concon', 'san antonio', 'quillota', 'los andes') THEN 'Valparaíso'
  WHEN unaccent_lower IN ('biobio', 'bio bio', 'region del biobio', 'concepcion', 'talcahuano', 'los angeles', 'chiguayante', 'san pedro de la paz', 'coronel') THEN 'Biobío'
  WHEN unaccent_lower IN ('rancagua', 'ohiggins', 'o''higgins', 'san fernando', 'machali') THEN 'O''Higgins'
  WHEN unaccent_lower IN ('talca', 'curico', 'linares', 'maule') THEN 'Maule'
  WHEN unaccent_lower IN ('chillan', 'nuble') THEN 'Ñuble'
  WHEN unaccent_lower IN ('temuco', 'la araucania', 'araucania', 'villarrica', 'pucon') THEN 'La Araucanía'
  WHEN unaccent_lower IN ('la serena', 'coquimbo', 'ovalle') THEN 'Coquimbo'
  WHEN unaccent_lower IN ('antofagasta', 'calama') THEN 'Antofagasta'
  WHEN unaccent_lower IN ('iquique', 'tarapaca', 'alto hospicio') THEN 'Tarapacá'
  WHEN unaccent_lower IN ('arica', 'arica y parinacota') THEN 'Arica y Parinacota'
  WHEN unaccent_lower IN ('copiapo', 'atacama') THEN 'Atacama'
  WHEN unaccent_lower IN ('valdivia', 'los rios') THEN 'Los Ríos'
  WHEN unaccent_lower IN ('puerto montt', 'osorno', 'los lagos', 'castro', 'puerto varas') THEN 'Los Lagos'
  WHEN unaccent_lower IN ('coyhaique', 'aysen') THEN 'Aysén'
  WHEN unaccent_lower IN ('punta arenas', 'magallanes') THEN 'Magallanes'
  ELSE region
END
FROM (
  SELECT id_tournament AS tid,
         TRIM(TRANSLATE(LOWER(region), 'áéíóúñü', 'aeiounu')) AS unaccent_lower
  FROM tournaments
  WHERE region IS NOT NULL
) norm
WHERE tournaments.id_tournament = norm.tid;
