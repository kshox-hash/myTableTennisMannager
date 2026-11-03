import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { SuperadminRepository } from "./superadmin_repository";
import { ClubsRepository } from "../clubs/clubs_repository";
import { confirmHandler, crestKey, headerKey, uploadUrlHandler } from "../clubs/clubs_router";
import { deleteObject } from "../media/r2_client";
import { NotificationsRepository } from "../notifications/notifications_repository";
import DB from "../db/db_configuration";
import { UserRepository } from "../users/user_repository";
import { UserService } from "../users/user_service";

const router = Router();
const repo = new SuperadminRepository();
const clubs = new ClubsRepository();
const users = new UserService(new UserRepository());
const notifications = new NotificationsRepository(DB.getPool());

// Estricto: "superadmin" nada más — a diferencia de casi todas las otras
// rutas de este backend, acá NO se quiere que un admin común entre (el
// bypass de requireRole es al revés: superadmin pasa cualquier gate de
// "admin", pero un admin normal no puede pasar este de "superadmin").
router.use(authRequired, requireRole("superadmin"));

const playersQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  filter: z.enum(["all", "enrolled"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const roleSchema = z.object({
  role: z.enum(["admin", "player"]),
});

const catalogSchema = z.object({
  name: z.string().trim().min(2).max(150),
  comuna: z.string().trim().max(80).nullable().optional(),
});
const assignAdminSchema = z.object({ email: z.string().trim().email().nullable() });
const approveClubSchema = z.object({ name: z.string().trim().min(2).max(150).optional() });

// ── Catálogo de clubes ───────────────────────────────────────

// GET /api/v1/superadmin/clubs
router.get(
  "/clubs",
  asyncHandler(async (_req, res) => res.json({ ok: true, data: await clubs.listCatalog() }))
);

// POST /api/v1/superadmin/clubs — agregar un club al catálogo
router.post(
  "/clubs",
  asyncHandler(async (req, res) => {
    const p = catalogSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos" });
    const r = await clubs.addToCatalog(p.data.name, p.data.comuna ?? null);
    if (!r.ok) return res.status(409).json({ ok: false, message: "Ya existe un club con ese nombre" });
    return res.status(201).json({ ok: true, data: { id_club: r.data } });
  })
);

// PATCH /api/v1/superadmin/clubs/:id_club — corregir nombre y comuna
router.patch(
  "/clubs/:id_club",
  asyncHandler(async (req, res) => {
    const p = catalogSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos" });
    const r = await clubs.updateCatalogClub(req.params.id_club, p.data.name, p.data.comuna ?? null);
    if (!r.ok) {
      return r.error === "CLUB_NAME_TAKEN"
        ? res.status(409).json({ ok: false, message: "Ya existe un club con ese nombre" })
        : res.status(404).json({ ok: false, message: "Club no encontrado" });
    }
    return res.json({ ok: true });
  })
);

// DELETE /api/v1/superadmin/clubs/:id_club — sus socios quedan sin club
router.delete(
  "/clubs/:id_club",
  asyncHandler(async (req, res) => {
    const r = await clubs.deleteFromCatalog(req.params.id_club);
    if (!r.ok) {
      return r.error === "CLUB_HAS_ADMIN"
        ? res.status(409).json({ ok: false, message: "Primero quita el administrador del club" })
        : res.status(404).json({ ok: false, message: "Club no encontrado" });
    }
    await Promise.all([
      deleteObject(headerKey(req.params.id_club)).catch(() => {}),
      deleteObject(crestKey(req.params.id_club)).catch(() => {}),
    ]);
    return res.json({ ok: true });
  })
);

// Escudo del club — mismo flujo que el dueño, para los clubes sin administrador.
router.post(
  "/clubs/:id_club/crest/upload-url",
  asyncHandler(async (req, res) => uploadUrlHandler(req, res, crestKey(req.params.id_club)))
);
router.post(
  "/clubs/:id_club/crest",
  asyncHandler(async (req, res) =>
    confirmHandler(req, res, crestKey(req.params.id_club), (url) => clubs.setCrestUrl(req.params.id_club, url))
  )
);
router.delete(
  "/clubs/:id_club/crest",
  asyncHandler(async (req, res) => {
    await clubs.setCrestUrl(req.params.id_club, null);
    await deleteObject(crestKey(req.params.id_club)).catch(() => {});
    return res.json({ ok: true });
  })
);

// PATCH /api/v1/superadmin/clubs/:id_club/admin — body: { email } (null = quitar)
router.patch(
  "/clubs/:id_club/admin",
  asyncHandler(async (req, res) => {
    const p = assignAdminSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Escribe un correo válido" });
    const r = await clubs.assignAdmin(req.params.id_club, p.data.email);
    if (!r.ok) {
      if (r.error === "USER_NOT_FOUND") return res.status(404).json({ ok: false, message: "No hay ninguna cuenta con ese correo" });
      if (r.error === "ALREADY_HAS_CLUB") return res.status(409).json({ ok: false, message: "Esa cuenta ya administra otro club" });
      return res.status(404).json({ ok: false, message: "Club no encontrado" });
    }
    return res.json({ ok: true });
  })
);

// GET /api/v1/superadmin/club-requests — pedidos de club nuevo pendientes
router.get(
  "/club-requests",
  asyncHandler(async (_req, res) => res.json({ ok: true, data: await clubs.listClubRequests() }))
);

// POST /api/v1/superadmin/club-requests/:id_request/approve — body: { name? }
router.post(
  "/club-requests/:id_request/approve",
  asyncHandler(async (req, res) => {
    const p = approveClubSchema.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ ok: false, message: "Nombre inválido" });
    const r = await clubs.approveClubRequest(req.params.id_request, req.user!.id_user, p.data.name);
    if (!r.ok) {
      if (r.error === "CLUB_NAME_TAKEN") return res.status(409).json({ ok: false, message: "Ya existe un club con ese nombre" });
      return res.status(404).json({ ok: false, message: "Solicitud no encontrada" });
    }
    await notifications.create({
      idUser: r.data.idUser,
      type: "club_join_approved",
      title: "Agregamos tu club",
      message: `${r.data.name} ya está en MyTTM y quedaste en ese club.`,
    });
    return res.json({ ok: true });
  })
);

// POST /api/v1/superadmin/club-requests/:id_request/reject
router.post(
  "/club-requests/:id_request/reject",
  asyncHandler(async (req, res) => {
    const r = await clubs.rejectClubRequest(req.params.id_request, req.user!.id_user);
    if (!r.ok) return res.status(404).json({ ok: false, message: "Solicitud no encontrada" });
    await notifications.create({
      idUser: r.data.idUser,
      type: "club_join_rejected",
      title: "No agregamos tu club",
      message: `Revisamos tu solicitud de ${r.data.name} y no la agregamos al catálogo. Si crees que es un error, escríbenos.`,
    });
    return res.json({ ok: true });
  })
);

// GET /api/v1/superadmin/admins
router.get(
  "/admins",
  asyncHandler(async (_req, res) => {
    const rows = await repo.listAdmins();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/stats — KPIs generales de la plataforma
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const data = await repo.getPlatformStats();
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/superadmin/stats/registrations?days=30
router.get(
  "/stats/registrations",
  asyncHandler(async (req, res) => {
    const daysRaw = Number(req.query.days ?? 30);
    const days = Number.isInteger(daysRaw) ? Math.min(365, Math.max(7, daysRaw)) : 30;
    const rows = await repo.getRegistrationsByDay(days);
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/stats/gender
router.get(
  "/stats/gender",
  asyncHandler(async (_req, res) => {
    const rows = await repo.getGenderBreakdown();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/stats/countries
router.get(
  "/stats/countries",
  asyncHandler(async (_req, res) => {
    const rows = await repo.getCountryBreakdown();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/stats/monthly-registrations?months=12
router.get(
  "/stats/monthly-registrations",
  asyncHandler(async (req, res) => {
    const monthsRaw = Number(req.query.months ?? 12);
    const months = Number.isInteger(monthsRaw) ? Math.min(36, Math.max(3, monthsRaw)) : 12;
    const rows = await repo.getMonthlyRegistrationsByRole(months);
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/stats/top-clubs
router.get(
  "/stats/top-clubs",
  asyncHandler(async (_req, res) => {
    const rows = await repo.getTopClubsByMembers();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/players?q=&filter=all|enrolled&limit=&offset=
router.get(
  "/players",
  asyncHandler(async (req, res) => {
    const p = playersQuerySchema.safeParse(req.query);
    if (!p.success) return res.status(400).json({ ok: false, message: "Parámetros inválidos" });
    const data = await repo.listPlayers({
      q: p.data.q,
      enrolledOnly: p.data.filter === "enrolled",
      limit: p.data.limit,
      offset: p.data.offset,
    });
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/superadmin/users/search?q=
router.get(
  "/users/search",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.status(400).json({ ok: false, message: "La búsqueda debe tener al menos 2 caracteres" });
    const rows = await repo.searchUsers(q);
    return res.json({ ok: true, data: rows });
  })
);

// POST /api/v1/superadmin/users/:id_user/role   body: { role: "admin" | "player" }
router.post(
  "/users/:id_user/role",
  asyncHandler(async (req, res) => {
    const p = roleSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    const updated = await repo.setUserRole(req.params.id_user, p.data.role);
    if (!updated) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, data: updated });
  })
);

// DELETE /api/v1/superadmin/users/:id_user — igual que "eliminar mi cuenta":
// la fila se anonimiza (sus partidos y rankings son también de los rivales).
const deletionMessages = {
  NOT_FOUND: [404, "Jugador no encontrado"],
  SUPERADMIN: [403, "Un superadministrador no se puede eliminar desde acá"],
  CLUB_ADMIN: [409, "Administra un club: primero quítalo como administrador del club"],
  HAS_TOURNAMENTS: [409, "Creó campeonatos: no se puede eliminar sin dejarlos sin organizador"],
} as const;

router.delete(
  "/users/:id_user",
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id_user).success) {
      return res.status(404).json({ ok: false, message: "Jugador no encontrado" });
    }
    if (req.params.id_user === req.user!.id_user) {
      return res.status(403).json({ ok: false, message: "No puedes eliminar tu propia cuenta desde acá" });
    }
    const blocker = await repo.deletionBlocker(req.params.id_user);
    if (blocker) {
      const [status, message] = deletionMessages[blocker];
      return res.status(status).json({ ok: false, message });
    }
    const result = await users.deleteAccount(req.params.id_user);
    if (!result.ok) return res.status(404).json({ ok: false, message: "Jugador no encontrado" });
    return res.json({ ok: true });
  })
);

export default router;
