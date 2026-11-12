import { Router } from "express";
import { z } from "zod";
import DB from "../db/db_configuration";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { demoRequestRateLimit } from "../middlewares/rate_limit_middleware";
import { sendMail } from "../core/mailer";

// POST /api/v1/demo-requests — formulario público "Solicitar demo".
// Guarda la solicitud (la ve el súper usuario en su panel) y avisa por
// email a DEMO_NOTIFY_EMAIL. Si el email falla, la solicitud igual queda.

const router = Router();
const notifyTo = process.env.DEMO_NOTIFY_EMAIL ?? "myttmadmin@gmail.com";

export const ORG_TYPES = ["club", "tournaments", "league", "federation", "school", "other"] as const;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  organization: z.string().trim().min(2).max(150),
  // El formulario ya no pregunta tipo ni cantidad de jugadores (quedan por compatibilidad).
  orgType: z.enum(ORG_TYPES).optional().default("other"),
  players: z.string().trim().max(40).optional().default(""),
  message: z.string().trim().min(5).max(2000),
  lang: z.string().trim().max(5).optional().default(""),
  // Trampa para bots: campo oculto en el formulario, una persona lo deja vacío.
  website: z.string().optional().default(""),
});

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

router.post(
  "/",
  demoRequestRateLimit,
  asyncHandler(async (req, res) => {
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Revisa los datos del formulario" });
    const d = p.data;
    if (d.website) return res.json({ ok: true }); // bot: se le responde ok y no se guarda

    await DB.getPool().query(
      `INSERT INTO demo_requests (name, email, phone, organization, org_type, players, message, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.name, d.email, d.phone || null, d.organization, d.orgType, d.players || null, d.message || null, d.lang || null]
    );

    const rows: [string, string][] = [
      ["Nombre", d.name],
      ["Email", d.email],
      ["WhatsApp", d.phone || "—"],
      ["Organización", d.organization],
      ["Mensaje", d.message],
    ];
    const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    const html =
      `<h2 style="font-family:sans-serif">Nueva solicitud de demo</h2><table style="font-family:sans-serif;font-size:14px">` +
      rows
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
        .join("") +
      `</table>`;
    void sendMail(notifyTo, `Solicitud de demo: ${d.organization}`, html, text);

    return res.json({ ok: true });
  })
);

export default router;
