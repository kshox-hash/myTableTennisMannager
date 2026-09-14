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
});

// POST /api/v1/clubs
router.post(
  "/",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    const idClub = await repo.create({
      created_by: req.user!.id_user,
      name: p.data.name,
      description: p.data.description ?? null,
      founded_date: p.data.founded_date ?? null,
    });
    return res.status(201).json({ ok: true, data: { id_club: idClub } });
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

// GET /api/v1/clubs — selector del jugador (cualquier usuario logueado)
router.get(
  "/",
  authRequired,
  requireRole(["admin", "player"]),
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
      await notifications.create({
        idUser: owner,
        type: "club_join_request",
        title: "Nueva solicitud de club",
        message: "Un jugador quiere unirse a uno de tus clubes. Revísalo en Clubes.",
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
      message: "Tu solicitud para unirte al club fue aceptada.",
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
      message: "Tu solicitud para unirte al club fue rechazada.",
    });
    return res.json({ ok: true });
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
