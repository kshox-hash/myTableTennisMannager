import fs   from "fs";
import path from "path";
import DB   from "./db_configuration";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Migraciones incrementales (seguras de re-ejecutar con IF NOT EXISTS).
// 000 se excluye porque tiene DROP TABLE CASCADE.
const INCREMENTAL = [
  "002_brackets.sql",
  "003_bracket_and_qualification.sql",
  "004_tournament_phases.sql",
  "005_checkin.sql",
  "006_enrollment_seed.sql",
  "007_tables.sql",
  "008_notifications.sql",
  "009_tournament_status.sql",
  "010_drop_checkin.sql",
  "011_match_set_scores.sql",
  "012_qualifiers_per_group.sql",
  "013_real_points_tiebreak.sql",
  "014_table_priority.sql",
  "015_played_table_number.sql",
  "016_match_referee.sql",
  "017_bracket_dead_slot.sql",
  "018_bracket_seed.sql",
  "019_group_position.sql",
  "020_group_match_schedule.sql",
  "021_ranking_points.sql",
  "022_drop_group_match_schedule.sql",
  "023_dispatch_priority.sql",
  "024_revert_dispatch_priority.sql",
  "025_drop_table_priority.sql",
  "026_user_active.sql",
  "027_tournament_organizers.sql",
  "028_activity_log.sql",
  "029_drop_user_active.sql",
  "030_checkin.sql",
  "031_player_registration_fields.sql",
  "032_dominant_hand.sql",
  "033_schedule_persist.sql",
  "034_match_player_indexes.sql",
  "035_tournaments_list_index.sql",
];

export async function runMigrations(): Promise<void> {
  const pool = DB.getPool();
  const client = await pool.connect();

  try {
    // Tabla de control (una sola vez)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of INCREMENTAL) {
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE migration = $1",
        [file]
      );
      if (rows.length > 0) continue; // ya aplicada

      const filePath = path.join(MIGRATIONS_DIR, file);
      if (!fs.existsSync(filePath)) {
        // Antes esto era un warning y seguía de largo — en producción el
        // build no copiaba los .sql a dist/ y todas las migraciones se
        // saltaban en silencio sin que el server nunca se enterara.
        throw new Error(`[migrations] archivo no encontrado: ${file} (¿el build copió src/db/migrations a dist/?)`);
      }

      const sql = fs.readFileSync(filePath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (migration) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`[migrations] ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrations] ✗ ${file}:`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
