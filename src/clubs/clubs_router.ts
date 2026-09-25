import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { ClubsRepository } from "./clubs_repository";
import { NotificationsRepository } from "../notifications/notifications_repository";
import {
  r2Configured,
  presignPutUrl,
  headObject,
  deleteObject,
  setCacheControl,
  publicUrlFor,
} from "../media/r2_client";

const router = Router();
const repo = new ClubsRepository();
const notifications = new NotificationsRepository();

const IMAGE_CONTENT_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB — header/escudo, generosos pero no un PUT arbitrario
const headerKey = (idClub: string) => `clubs/${idClub}/header.webp`;
const crestKey = (idClub: string) => `clubs/${idClub}/crest.webp`;

// Dueño del club — mismo criterio que requireTournamentOwnership en
// leagues: un club no tiene coorganizadores (fuera de alcance por ahora),
// así que el chequeo es directo contra created_by.
async function requireOwnClub(req: Request, res: Response, next: NextFunction) {
  const idClub = req.params.id_club as string;
  const owner = await repo.getOwner(idClub);
  if (owner === null) return res.status(404).json({ ok: false, message: "Club no encontrado" });
  if (owner !== req.user!.id_user) return res.status(403).json({ ok: false, message: "No eres dueño de este club" });
  next();
}

const ERR: Record<string, [number, string]> = {
  CLUB_NOT_FOUND: [404, "Club no encontrado"],
  ALREADY_PENDING: [409, "Ya tienes una solicitud pendiente — espera la respuesta o cancélala"],
  REQUEST_NOT_FOUND: [404, "Solicitud no encontrada"],
  ALREADY_HAS_CLUB: [409, "Ya tienes un club creado — cada cuenta puede tener uno solo"],
  ALREADY_MEMBER: [409, "Ya perteneces a ese club"],
  NO_CLUB: [404, "No perteneces a ningún club"],
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(4000).nullable().optional(),
  founded_date: z.string().trim().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  founded_date: z.string().trim().nullable().optional(),
  monthly_fee: z.number().min(0).max(99999999).nullable().optional(),
  fee_frequency: z.enum(["monthly", "weekly"]).optional(),
});

const dueSchema = z.object({
  period_start: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de periodo inválida"),
  paid: z.boolean(),
  amount: z.number().min(0).max(99999999),
  // Qué periodo está mirando el admin ahora mismo (0 = actual, -1 = el
  // anterior, etc.) — se usa solo para devolver ESE mismo periodo
  // actualizado, no siempre el actual, si está revisando uno pasado.
  offset: z.number().int().min(-1000).max(1000).default(0),
});

const cashMovementSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive().max(99999999),
  description: z.string().trim().min(1).max(200),
  occurred_at: z.string().trim().nullable().optional(),
});

const selectedSchema = z.object({
  selected: z.boolean(),
});

// POST /api/v1/clubs
router.post(
  "/",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });

    if (await repo.hasClub(req.user!.id_user)) {
      const [code, msg] = ERR.ALREADY_HAS_CLUB;
      return res.status(code).json({ ok: false, message: msg });
    }

    try {
      const idClub = await repo.create({
        created_by: req.user!.id_user,
        name: p.data.name,
        description: p.data.description ?? null,
        founded_date: p.data.founded_date ?? null,
      });
      return res.status(201).json({ ok: true, data: { id_club: idClub } });
    } catch (e: any) {
      // Viola idx_clubs_one_per_admin — dos POST casi simultáneos ganándole
      // al chequeo de arriba (mismo criterio que ALREADY_PENDING en /join).
      if (e?.code === "23505") {
        const [code, msg] = ERR.ALREADY_HAS_CLUB;
        return res.status(code).json({ ok: false, message: msg });
      }
      throw e;
    }
  })
);

// GET /api/v1/clubs/mine
router.get(
  "/mine",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const rows = await repo.listMine(req.user!.id_user);
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/clubs — selector del club: sin login, para que ya aparezca en
// el formulario de registro (antes de que exista sesión) y no solo en Perfil.
// Solo expone nombre/escudo, nada sensible.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await repo.listPublic();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/clubs/me/request — mi solicitud actual (jugador)
router.get(
  "/me/request",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const row = await repo.getMyRequest(req.user!.id_user);
    return res.json({ ok: true, data: row });
  })
);

// DELETE /api/v1/clubs/me/request — cancelar mi solicitud pendiente
router.delete(
  "/me/request",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const removed = await repo.cancelMyRequest(req.user!.id_user);
    if (!removed) return res.status(404).json({ ok: false, message: "No tienes una solicitud pendiente" });
    return res.json({ ok: true });
  })
);

// DELETE /api/v1/clubs/me/membership — salir de mi club actual
router.delete(
  "/me/membership",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const r = await repo.leaveClub(req.user!.id_user);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    return res.json({ ok: true });
  })
);

// POST /api/v1/clubs/:id_club/join — pedir unirse (jugador)
router.post(
  "/:id_club/join",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (req, res) => {
    const r = await repo.requestJoin(req.params.id_club, req.user!.id_user);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }

    const owner = await repo.getOwner(req.params.id_club);
    if (owner) {
      const [who, clubName] = await Promise.all([
        repo.getUserDisplayName(req.user!.id_user),
        repo.getClubName(req.params.id_club),
      ]);
      await notifications.create({
        idUser: owner,
        type: "club_join_request",
        title: "Nueva solicitud de club",
        message: `${who ?? "Un jugador"} quiere unirse a ${clubName ?? "tu club"}. Tócala para aceptarla o rechazarla.`,
      });
    }

    return res.status(201).json({ ok: true, data: r.data });
  })
);

// GET /api/v1/clubs/:id_club  (admin, dueño — detalle completo)
router.get(
  "/:id_club",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const d = await repo.getDetail(req.params.id_club);
    if (!d) return res.status(404).json({ ok: false, message: "Club no encontrado" });
    return res.json({ ok: true, data: d });
  })
);

// PATCH /api/v1/clubs/:id_club  (admin, dueño)
router.patch(
  "/:id_club",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const p = updateSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    await repo.update(req.params.id_club, p.data);
    const d = await repo.getDetail(req.params.id_club);
    return res.json({ ok: true, data: d });
  })
);

// DELETE /api/v1/clubs/:id_club  (admin, dueño)
router.delete(
  "/:id_club",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    // Best-effort: si el borrado del objeto en R2 falla (ya no existía,
    // R2 no configurado, etc.) no bloquea borrar el club igual.
    await Promise.all([
      deleteObject(headerKey(req.params.id_club)).catch(() => {}),
      deleteObject(crestKey(req.params.id_club)).catch(() => {}),
    ]);
    await repo.delete(req.params.id_club);
    return res.json({ ok: true });
  })
);

// POST /api/v1/clubs/:id_club/requests/:id_request/approve  (admin, dueño)
router.post(
  "/:id_club/requests/:id_request/approve",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const r = await repo.decide(req.params.id_club, req.params.id_request, "approved", req.user!.id_user);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    await notifications.create({
      idUser: r.data.id_user,
      type: "club_join_approved",
      title: "Solicitud aceptada",
      message: `¡Ya eres parte de ${(await repo.getClubName(req.params.id_club)) ?? "el club"}!`,
    });
    return res.json({ ok: true });
  })
);

// POST /api/v1/clubs/:id_club/requests/:id_request/reject  (admin, dueño)
router.post(
  "/:id_club/requests/:id_request/reject",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const r = await repo.decide(req.params.id_club, req.params.id_request, "rejected", req.user!.id_user);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    await notifications.create({
      idUser: r.data.id_user,
      type: "club_join_rejected",
      title: "Solicitud rechazada",
      message: `${(await repo.getClubName(req.params.id_club)) ?? "El club"} rechazó tu solicitud. Puedes pedir unirte a otro club desde tu perfil.`,
    });
    return res.json({ ok: true });
  })
);

// --- Cuotas ---

// GET /api/v1/clubs/:id_club/dues?offset=0  (admin, dueño)
// offset entero: 0 = periodo actual (semana o mes según clubs.fee_frequency),
// negativo = periodos anteriores. El frontend no arma fechas, solo navega.
router.get(
  "/:id_club/dues",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const rawOffset = typeof req.query.offset === "string" ? Number(req.query.offset) : 0;
    if (!Number.isInteger(rawOffset) || rawOffset < -1000 || rawOffset > 1000) {
      return res.status(400).json({ ok: false, message: "Offset de periodo inválido" });
    }
    const period = await repo.getDues(req.params.id_club, rawOffset);
    if (!period) return res.status(404).json({ ok: false, message: "Club no encontrado" });
    return res.json({ ok: true, data: period });
  })
);

// PUT /api/v1/clubs/:id_club/dues/:id_user  (admin, dueño) — marcar pagada/pendiente
router.put(
  "/:id_club/dues/:id_user",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const p = dueSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    if (!(await repo.isMember(req.params.id_club, req.params.id_user))) {
      return res.status(404).json({ ok: false, message: "Ese jugador no es socio de este club" });
    }
    const result = await repo.setDuePaid(req.params.id_club, req.params.id_user, p.data.period_start, p.data.paid, p.data.amount);
    if (!result.ok) {
      return res.status(400).json({ ok: false, message: "Ese periodo es anterior a que este jugador fuera socio del club" });
    }
    const period = await repo.getDues(req.params.id_club, p.data.offset);
    return res.json({ ok: true, data: period });
  })
);

// GET /api/v1/clubs/:id_club/arrears  (admin, dueño) — morosidad acumulada
router.get(
  "/:id_club/arrears",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const rows = await repo.getArrears(req.params.id_club);
    return res.json({ ok: true, data: rows });
  })
);

// --- Caja ---

// GET /api/v1/clubs/:id_club/cash  (admin, dueño)
router.get(
  "/:id_club/cash",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const summary = await repo.getCashMovements(req.params.id_club);
    return res.json({ ok: true, data: summary });
  })
);

// POST /api/v1/clubs/:id_club/cash  (admin, dueño)
router.post(
  "/:id_club/cash",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const p = cashMovementSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    await repo.addCashMovement(req.params.id_club, {
      type: p.data.type,
      amount: p.data.amount,
      description: p.data.description,
      occurred_at: p.data.occurred_at ?? null,
      created_by: req.user!.id_user,
    });
    const summary = await repo.getCashMovements(req.params.id_club);
    return res.status(201).json({ ok: true, data: summary });
  })
);

// DELETE /api/v1/clubs/:id_club/cash/:id_movement  (admin, dueño)
router.delete(
  "/:id_club/cash/:id_movement",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const removed = await repo.deleteCashMovement(req.params.id_club, req.params.id_movement);
    if (!removed) return res.status(404).json({ ok: false, message: "Movimiento no encontrado" });
    const summary = await repo.getCashMovements(req.params.id_club);
    return res.json({ ok: true, data: summary });
  })
);

// --- Plantel seleccionado ---

// PUT /api/v1/clubs/:id_club/selected/:id_user  (admin, dueño)
router.put(
  "/:id_club/selected/:id_user",
  authRequired,
  requireRole("admin"),
  requireOwnClub,
  asyncHandler(async (req, res) => {
    const p = selectedSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    if (!(await repo.isMember(req.params.id_club, req.params.id_user))) {
      return res.status(404).json({ ok: false, message: "Ese jugador no es socio de este club" });
    }
    await repo.setSelected(req.params.id_club, req.params.id_user, p.data.selected);
    const d = await repo.getDetail(req.params.id_club);
    return res.json({ ok: true, data: d });
  })
);

// --- Imágenes (header/escudo) — mismo flujo presigned que el avatar de
// usuario (ver user_service.ts): 1) URL firmada, 2) PUT directo a R2 desde
// el navegador, 3) confirmar acá para guardar la URL pública. ---

async function uploadUrlHandler(req: Request, res: Response, key: string) {
  if (!r2Configured) return res.status(503).json({ ok: false, message: "El almacenamiento de imágenes no está configurado." });
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "";
  if (!IMAGE_CONTENT_TYPES.includes(contentType)) {
    return res.status(400).json({ ok: false, message: "Formato de imagen no permitido (usa JPG, PNG o WEBP)." });
  }
  const uploadUrl = await presignPutUrl(key, contentType);
  return res.json({ ok: true, data: { uploadUrl, key, publicUrl: publicUrlFor(key) } });
}

async function confirmHandler(req: Request, res: Response, key: string, save: (url: string | null) => Promise<void>) {
  if (!r2Configured) return res.status(503).json({ ok: false, message: "El almacenamiento de imágenes no está configurado." });
  const bodyKey = typeof req.body?.key === "string" ? req.body.key : "";
  if (bodyKey !== key) return res.status(400).json({ ok: false, message: "Solicitud inválida." });

  const meta = await headObject(key);
  if (!meta) return res.status(404).json({ ok: false, message: "No se encontró la imagen subida. Inténtalo de nuevo." });
  if (meta.size > MAX_IMAGE_BYTES || !meta.contentType.startsWith("image/")) {
    await deleteObject(key).catch(() => {});
    return res.status(400).json({ ok: false, message: "La imagen es inválida o muy pesada." });
  }
  await setCacheControl(key, meta.contentType).catch(() => {});

  const url = `${publicUrlFor(key)}?v=${Date.now()}`;
  await save(url);
  const d = await repo.getDetail(req.params.id_club);
  return res.json({ ok: true, data: d });
}

router.post(
  "/:id_club/header/upload-url",
  authRequired, requireRole("admin"), requireOwnClub,
  asyncHandler(async (req, res) => uploadUrlHandler(req, res, headerKey(req.params.id_club)))
);
router.post(
  "/:id_club/header",
  authRequired, requireRole("admin"), requireOwnClub,
  asyncHandler(async (req, res) => confirmHandler(req, res, headerKey(req.params.id_club), (url) => repo.setHeaderUrl(req.params.id_club, url)))
);
router.post(
  "/:id_club/crest/upload-url",
  authRequired, requireRole("admin"), requireOwnClub,
  asyncHandler(async (req, res) => uploadUrlHandler(req, res, crestKey(req.params.id_club)))
);
router.post(
  "/:id_club/crest",
  authRequired, requireRole("admin"), requireOwnClub,
  asyncHandler(async (req, res) => confirmHandler(req, res, crestKey(req.params.id_club), (url) => repo.setCrestUrl(req.params.id_club, url)))
);

export default router;
