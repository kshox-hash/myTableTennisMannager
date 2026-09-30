import DB from "../db/db_configuration";

// Envío de notificaciones push (Firebase Cloud Messaging) a los celulares
// del jugador. Se activa SOLO si está la variable de entorno
// FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio del
// proyecto de Firebase (Consola de Firebase → Configuración del proyecto →
// Cuentas de servicio → Generar nueva clave privada). Sin esa variable todo
// esto es un no-op: las notificaciones se siguen guardando y viendo dentro
// de la app como siempre.
//
// Nunca lanza: una falla de push no puede romper la acción que la originó
// (cargar un resultado, asignar mesa, etc.).

type Messaging = {
  sendEachForMulticast: (msg: {
    tokens: string[];
    notification: { title: string; body: string };
    data?: Record<string, string>;
    android?: { priority: "high" | "normal"; notification?: { channelId?: string; sound?: string } };
    apns?: { payload: { aps: { sound?: string } } };
  }) => Promise<{ responses: { success: boolean; error?: { code?: string } }[] }>;
};

let messaging: Messaging | null | undefined;

async function getMessaging(): Promise<Messaging | null> {
  if (messaging !== undefined) return messaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return (messaging = null);
  try {
    const admin = await import("firebase-admin");
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    messaging = app.messaging() as unknown as Messaging;
  } catch (err) {
    console.error("[push] no se pudo inicializar Firebase:", err);
    messaging = null;
  }
  return messaging;
}

export function pushEnabled(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}

export async function sendPush(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, string | null | undefined> }
): Promise<void> {
  try {
    if (!pushEnabled() || userIds.length === 0) return;
    const m = await getMessaging();
    if (!m) return;
    const pool = DB.getPool();
    const res = await pool.query<{ token: string }>(
      `SELECT token FROM device_tokens WHERE id_user = ANY($1::uuid[])`,
      [[...new Set(userIds)]]
    );
    const tokens = res.rows.map((r) => r.token);
    if (tokens.length === 0) return;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.data ?? {})) if (v != null) data[k] = String(v);

    // FCM acepta hasta 500 tokens por envío.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const out = await m.sendEachForMulticast({
        tokens: batch,
        notification: { title: payload.title, body: payload.body },
        data,
        android: { priority: "high", notification: { channelId: "myttm_partidos", sound: "default" } },
        apns: { payload: { aps: { sound: "default" } } },
      });
      // Tokens que ya no existen (app desinstalada, sesión cerrada): se borran.
      const dead = out.responses
        .map((r, idx) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? "") ? batch[idx] : null))
        .filter((t): t is string => t !== null);
      if (dead.length) await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [dead]);
    }
  } catch (err) {
    console.error("[push] error enviando:", err);
  }
}

// Diagnóstico ("Probar notificaciones" en la app): manda un aviso de prueba
// a los celulares del usuario y devuelve qué pasó en cada paso, en vez de
// fallar en silencio como sendPush.
export async function pushSelfTest(idUser: string): Promise<{
  enabled: boolean;
  firebase: boolean;
  tokens: number;
  sent: number;
  errors: string[];
}> {
  const result = { enabled: pushEnabled(), firebase: false, tokens: 0, sent: 0, errors: [] as string[] };
  if (!result.enabled) return result;
  const m = await getMessaging();
  result.firebase = Boolean(m);
  if (!m) return result;
  const pool = DB.getPool();
  const res = await pool.query<{ token: string }>(`SELECT token FROM device_tokens WHERE id_user = $1`, [idUser]);
  const tokens = res.rows.map((r) => r.token);
  result.tokens = tokens.length;
  if (tokens.length === 0) return result;
  try {
    const out = await m.sendEachForMulticast({
      tokens,
      notification: { title: "Prueba de MyTTM", body: "Las notificaciones funcionan en este celular." },
      data: { type: "push_test" },
      android: { priority: "high", notification: { channelId: "myttm_partidos", sound: "default" } },
    });
    result.sent = out.responses.filter((r) => r.success).length;
    result.errors = out.responses.filter((r) => !r.success).map((r) => r.error?.code ?? "desconocido");
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}
