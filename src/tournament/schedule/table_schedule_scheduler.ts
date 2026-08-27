import { ScheduleRepository } from "./schedule_repository";
import { TablesRepository } from "../tables/tables_repository";

// Mismo molde que phase_scheduler.ts (que ya corre en producción cada 30s
// para pasar categorías de fase sola): revisa qué partidos de grupo tienen
// horario confirmado que ya llegó, y los activa en la mesa programada vía
// el mismo assignTable() que usa el despacho manual — así se disparan las
// mismas validaciones (mesa libre, jugador no ocupado) y la misma
// notificación push al jugador ("¡Tu mesa está lista!").
//
// Si assignTable() falla (la mesa programada sigue ocupada por otro
// partido que se alargó, o algún jugador sigue jugando otra cosa), no se
// reintenta agresivo ni se reprograma solo: el partido simplemente sigue
// "vencido" y se reintenta en la próxima pasada, hasta que la mesa/jugador
// se liberen de verdad. Degrada con gracia al despacho manual normal en
// vez de intentar replanificar todo automáticamente.
export function startTableScheduleScheduler(intervalMs = 30_000) {
  const scheduleRepo = new ScheduleRepository();
  const tablesRepo = new TablesRepository();

  setInterval(async () => {
    try {
      const due = await scheduleRepo.getDueScheduledMatches();
      for (const match of due) {
        try {
          await tablesRepo.assignTable(
            match.id_match,
            "group",
            match.scheduled_table_number,
            match.created_by
          );
        } catch (err) {
          // Mesa ocupada o jugador ocupado — se reintenta solo en la
          // próxima pasada, no hace falta loguear cada 30s de espera.
        }
      }
    } catch (err) {
      console.error("[TableScheduleScheduler] error:", err);
    }
  }, intervalMs);

  console.log(`[TableScheduleScheduler] iniciado — revisando cada ${intervalMs / 1000}s`);
}
