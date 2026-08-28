-- ============================================================
--  Genera 1000 torneos de prueba, con categorías, inscripciones,
--  grupos y partidos con resultados al azar — para ver cómo se
--  comporta la paginación con volumen real.
--
--  Pensado para correr UNA VEZ en DBeaver contra la base de
--  producción (o cualquier base con el schema al día, migración
--  033 incluida). Es idempotente por email/nombre: si ya corrió
--  antes, aborta con un mensaje en vez de duplicar todo de nuevo.
--
--  Volumen aproximado: 12 admins + 400 jugadores sintéticos,
--  1000 torneos, ~3000 categorías, ~31.500 inscripciones,
--  ~10.500 grupos (de 3 jugadores cada uno, todos contra todos)
--  y ~31.500 partidos de grupo (~85% ya jugados con resultado al
--  azar, el resto "scheduled" sin jugar).
--
--  Todos los usuarios sintéticos comparten:
--    contraseña: Demo12345!
--    email admin:   demo.adminNN@isttm.local
--    email jugador: demo.playerNNN@isttm.local
--  (podés loguearte con cualquiera para probar la vista de admin).
--
--  Para deshacer todo esto más adelante, hay un script de borrado
--  al final del archivo (comentado a propósito, no se ejecuta solo).
-- ============================================================

BEGIN;

-- Guarda de idempotencia: si esto ya corrió, no lo vuelve a hacer.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tournaments WHERE tournament_name = 'Torneo Demo #0001') THEN
    RAISE EXCEPTION 'Los torneos demo ya existen (encontré "Torneo Demo #0001") — no se vuelve a correr para no duplicar. Si querés recrearlos, corré primero el script de borrado del final de este archivo.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) Admins sintéticos (12) — los 1000 torneos se reparten entre
--    ellos en vez de quedar todos bajo un solo organizador.
-- ------------------------------------------------------------
INSERT INTO users (id_user, email, password_hash, id_role, first_name, last_name)
SELECT
  gen_random_uuid(),
  'demo.admin' || lpad(i::text, 2, '0') || '@isttm.local',
  '$2b$10$0z1RKkhecQZKwuiSfDdnXe7SdlXS0.4dCanrsjgaexggBjTsDA6kS', -- Demo12345!
  '11111111-1111-1111-1111-111111111111',
  'Admin Demo',
  lpad(i::text, 2, '0')
FROM generate_series(1, 12) AS i
ON CONFLICT (email) DO NOTHING;

CREATE TEMP TABLE _demo_admins AS
SELECT id_user, row_number() OVER (ORDER BY email) AS rn
FROM users
WHERE email LIKE 'demo.admin%@isttm.local';

-- ------------------------------------------------------------
-- 2) Jugadores sintéticos (400) — pool compartido, se reusan a
--    través de distintos torneos (como pasaría con jugadores
--    reales que compiten seguido).
-- ------------------------------------------------------------
INSERT INTO users (id_user, email, password_hash, id_role, first_name, last_name, gender)
SELECT
  gen_random_uuid(),
  'demo.player' || lpad(i::text, 3, '0') || '@isttm.local',
  '$2b$10$0z1RKkhecQZKwuiSfDdnXe7SdlXS0.4dCanrsjgaexggBjTsDA6kS', -- Demo12345!
  '22222222-2222-2222-2222-222222222222',
  (ARRAY['Diego','Sebastián','Matías','Tomás','Rafael','Camila','Valentina','Josefa','Antonia','Fernanda',
         'Ignacio','Benjamín','Martina','Florencia','Agustín','Vicente','Emilia','Isidora','Joaquín','Maximiliano'])[1 + (i % 20)],
  (ARRAY['Pérez','González','Muñoz','Rojas','Soto','Contreras','Silva','Martínez','Sepúlveda','Castro',
         'Fuentes','Araya','Reyes','Torres','Espinoza','Carrasco','Valenzuela','Bravo','Figueroa','Riquelme'])[1 + ((i * 7) % 20)],
  CASE WHEN i % 2 = 0 THEN 'male' ELSE 'female' END
FROM generate_series(1, 400) AS i
ON CONFLICT (email) DO NOTHING;

CREATE TEMP TABLE _demo_players AS
SELECT id_user, row_number() OVER (ORDER BY email) AS rn
FROM users
WHERE email LIKE 'demo.player%@isttm.local';

-- ------------------------------------------------------------
-- 3) 1000 torneos, repartidos round-robin entre los 12 admins,
--    fechas mezcladas (pasado y futuro) para que la lista pública
--    muestre una mezcla de "Finalizado" / próximos.
-- ------------------------------------------------------------
INSERT INTO tournaments (id_tournament, tournament_name, description, created_by, address, region, event_date, event_time, status, num_tables)
SELECT
  gen_random_uuid(),
  'Torneo Demo #' || lpad(i::text, 4, '0') || ' — ' ||
    (ARRAY['Santiago','Valparaíso','Concepción','Temuco','La Serena','Rancagua',
           'Talca','Antofagasta','Puerto Montt','Viña del Mar','Iquique','Chillán'])[1 + (i % 12)],
  'Torneo generado automáticamente para probar la paginación con volumen real — no es un campeonato real.',
  (SELECT id_user FROM _demo_admins WHERE rn = 1 + (i % 12)),
  'Av. Demo ' || (100 + i) || ', ' ||
    (ARRAY['Santiago','Valparaíso','Concepción','Temuco','La Serena','Rancagua',
           'Talca','Antofagasta','Puerto Montt','Viña del Mar','Iquique','Chillán'])[1 + (i % 12)],
  (ARRAY['Metropolitana de Santiago','Valparaíso','Biobío','La Araucanía','Coquimbo','O''Higgins',
         'Maule','Antofagasta','Los Lagos','Valparaíso','Tarapacá','Ñuble'])[1 + (i % 12)],
  (CURRENT_DATE - 150 + ((i * 11) % 240))::date,
  '09:00',
  CASE WHEN i % 25 = 0 THEN 'cancelled' ELSE 'active' END,
  2 + (i % 6)
FROM generate_series(1, 1000) AS i;

CREATE TEMP TABLE _demo_tournaments AS
SELECT id_tournament, row_number() OVER (ORDER BY tournament_name) AS rn
FROM tournaments
WHERE tournament_name LIKE 'Torneo Demo #%';

-- ------------------------------------------------------------
-- 4) Categorías — entre 1 y 5 por torneo. phase='groups' directo
--    (no 'enrollment'), porque más abajo ya les generamos grupos
--    y partidos — así el panel admin las muestra en el estado
--    que corresponde en vez de decir "todavía sin grupos".
-- ------------------------------------------------------------
INSERT INTO tournament_categories (id_category, id_tournament, category_type, category_range, gender, inscription_price, quotas, status, phase)
SELECT
  gen_random_uuid(),
  t.id_tournament,
  cat_type,
  CASE WHEN cat_type = 'Master'
    THEN (ARRAY['35–39','40–44','45–49','50–54','55–59','60–64'])[1 + ((t.rn + n) % 6)]
    ELSE 'General'
  END,
  (ARRAY['male','female','mixed'])[1 + ((t.rn * 3 + n) % 3)],
  (3000 + (((t.rn + n) % 8) * 1000))::numeric,
  NULL,
  'active',
  'groups'
FROM _demo_tournaments t
CROSS JOIN generate_series(1, 1 + ((t.rn * 7) % 5)) AS n
CROSS JOIN LATERAL (
  SELECT (ARRAY['Peneca','Preinfantil','Infantil','Juvenil','U23','Iniciación','Intermedio','Todo Competidor','Master'])[1 + ((t.rn + n * 3) % 9)] AS cat_type
) x;

CREATE TEMP TABLE _demo_categories AS
SELECT tc.id_category, tc.id_tournament
FROM tournament_categories tc
JOIN _demo_tournaments t USING (id_tournament);

-- ------------------------------------------------------------
-- 5) Inscripciones — entre 6 y 15 jugadores por categoría, SIEMPRE
--    múltiplo de 3 (6/9/12/15) para poder armar grupos de 3 parejos
--    sin tener que replicar acá el algoritmo de remanentes real.
-- ------------------------------------------------------------
-- BUG encontrado y corregido: la subconsulta original no hacía referencia
-- a ninguna columna de `c`, así que Postgres no la trataba como
-- verdaderamente correlacionada pese al LATERAL — la ejecutaba UNA sola
-- vez y reusaba el mismo resultado para las 3000 categorías (verificado:
-- terminó con solo 9 jugadores distintos en total, cada uno en 3000
-- inscripciones exactas). La referencia a `c.id_category IS NOT NULL`
-- (siempre verdadera) fuerza la correlación real, así cada categoría saca
-- su propia muestra al azar de los 400.
INSERT INTO enrollments (id_enrollment, id_user, id_tournament, id_category, status, qualification_type)
SELECT gen_random_uuid(), p.id_user, c.id_tournament, c.id_category, 'active', 'group'
FROM _demo_categories c
CROSS JOIN LATERAL (
  SELECT id_user FROM _demo_players
  WHERE c.id_category IS NOT NULL
  ORDER BY random() LIMIT (3 * (2 + floor(random() * 4)))::int
) p;

CREATE TEMP TABLE _demo_enrolled AS
SELECT e.id_category, e.id_tournament, e.id_user,
       row_number() OVER (PARTITION BY e.id_category ORDER BY random()) AS player_rn
FROM enrollments e
JOIN _demo_categories c USING (id_category);

-- ------------------------------------------------------------
-- 6) Grupos de 3 — nombrados A, B, C... por categoría.
-- ------------------------------------------------------------
INSERT INTO category_groups (id_group, id_tournament, id_category, group_name, target_size, sort_order, status, group_kind)
SELECT
  gen_random_uuid(), id_tournament, id_category,
  chr(64 + group_index),
  3,
  group_index,
  'active',
  'normal'
FROM (
  SELECT DISTINCT id_tournament, id_category, ((player_rn - 1) / 3 + 1)::int AS group_index
  FROM _demo_enrolled
) g;

CREATE TEMP TABLE _demo_groups AS
SELECT cg.id_group, cg.id_tournament, cg.id_category, cg.sort_order AS group_index
FROM category_groups cg
JOIN _demo_categories dc USING (id_category);

-- ------------------------------------------------------------
-- 7) Miembros de grupo.
-- ------------------------------------------------------------
INSERT INTO group_members (id_group, id_user, seed, assignment_type, group_position)
SELECT g.id_group, e.id_user, e.player_rn, 'auto', ((e.player_rn - 1) % 3 + 1)::int
FROM _demo_enrolled e
JOIN _demo_groups g
  ON g.id_category = e.id_category
 AND g.group_index = ((e.player_rn - 1) / 3 + 1)::int;

-- ------------------------------------------------------------
-- 8) Partidos todos-contra-todos dentro de cada grupo (3 por
--    grupo) — ~85% ya jugados con resultado al azar (mejor de 3),
--    el resto queda "scheduled" sin jugar.
-- ------------------------------------------------------------
WITH pairs AS (
  SELECT
    g.id_group, g.id_tournament, g.id_category,
    p1.id_user AS player1_id, p2.id_user AS player2_id,
    row_number() OVER (PARTITION BY g.id_group ORDER BY p1.group_position, p2.group_position) AS match_number,
    (random() < 0.85) AS played,
    (random() < 0.5) AS p1_wins,
    (random() < 0.5) AS loser_won_a_set
  FROM _demo_groups g
  JOIN group_members p1 ON p1.id_group = g.id_group
  JOIN group_members p2 ON p2.id_group = g.id_group AND p2.group_position > p1.group_position
)
INSERT INTO group_matches (
  id_match, id_group, id_tournament, id_category, stage, round_number, match_number,
  best_of_sets, player1_id, player2_id, winner_id, sets_player1, sets_player2,
  status, source_note, played_at
)
SELECT
  gen_random_uuid(), id_group, id_tournament, id_category, 'group', 1, match_number,
  3, player1_id, player2_id,
  CASE WHEN played THEN (CASE WHEN p1_wins THEN player1_id ELSE player2_id END) ELSE NULL END,
  CASE WHEN NOT played THEN 0
       WHEN p1_wins THEN 2
       ELSE (CASE WHEN loser_won_a_set THEN 1 ELSE 0 END)
  END,
  CASE WHEN NOT played THEN 0
       WHEN p1_wins THEN (CASE WHEN loser_won_a_set THEN 1 ELSE 0 END)
       ELSE 2
  END,
  CASE WHEN played THEN 'played' ELSE 'scheduled' END,
  'group_stage',
  CASE WHEN played THEN NOW() - (random() * 30 || ' days')::interval ELSE NULL END
FROM pairs;

-- ------------------------------------------------------------
-- Limpieza de tablas temporales y resumen final.
-- ------------------------------------------------------------
DROP TABLE _demo_admins;
DROP TABLE _demo_players;
DROP TABLE _demo_tournaments;
DROP TABLE _demo_categories;
DROP TABLE _demo_enrolled;
DROP TABLE _demo_groups;

COMMIT;

-- Resumen (corré esto después del COMMIT para confirmar):
SELECT
  (SELECT count(*) FROM tournaments WHERE tournament_name LIKE 'Torneo Demo #%')       AS torneos,
  (SELECT count(*) FROM tournament_categories tc JOIN tournaments t USING (id_tournament) WHERE t.tournament_name LIKE 'Torneo Demo #%') AS categorias,
  (SELECT count(*) FROM enrollments e JOIN tournaments t USING (id_tournament) WHERE t.tournament_name LIKE 'Torneo Demo #%')            AS inscripciones,
  (SELECT count(*) FROM group_matches gm JOIN tournaments t USING (id_tournament) WHERE t.tournament_name LIKE 'Torneo Demo #%')         AS partidos;


-- ============================================================
--  BORRADO — para deshacer todo lo de arriba más adelante.
--  A PROPÓSITO comentado: seleccioná el bloque y corrélo a mano
--  cuando quieras sacar los datos de prueba. Borra en cascada
--  (FKs con ON DELETE CASCADE) así que alcanza con borrar los
--  torneos y los usuarios sintéticos.
-- ============================================================
-- BEGIN;
-- DELETE FROM tournaments WHERE tournament_name LIKE 'Torneo Demo #%';
-- DELETE FROM users WHERE email LIKE 'demo.admin%@isttm.local' OR email LIKE 'demo.player%@isttm.local';
-- COMMIT;
