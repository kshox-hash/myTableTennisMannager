import { Router } from "express";

// GET /api/v1/app/version — sin login. La app del jugador lo consulta al
// abrir: si su número de build es menor que min_build, bloquea con
// "Actualiza MyTTM"; si es menor que latest_build, sugiere actualizar.
// Sirve para cuando un cambio del servidor deja inservible una versión vieja
// de la app (sin esto, quien no actualizó vería errores sin saber por qué).
//
// Se configura en Render, sin redeploy de la app:
//   APP_MIN_BUILD     — build mínimo aceptado (default 0 = ninguno bloqueado)
//   APP_LATEST_BUILD  — último build publicado (default 0 = sin sugerencia)
//   APP_UPDATE_URL    — dónde actualizar (Play Store, o la descarga del APK
//                       mientras la app no esté en la tienda)
const appVersionRouter = Router();

const int = (v: string | undefined) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

appVersionRouter.get("/version", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    data: {
      min_build: int(process.env.APP_MIN_BUILD),
      latest_build: int(process.env.APP_LATEST_BUILD),
      update_url: process.env.APP_UPDATE_URL || "https://play.google.com/store/apps/details?id=cl.myttm.app",
    },
  });
});

// GET /api/v1/app/download — el botón "Descargar para Android" de la web.
// Redirige al APK de APP_UPDATE_URL: un solo lugar (Render) define qué
// versión baja la web y a cuál se actualizan las apps instaladas. Sin APK
// configurado, vuelve a la web.
appVersionRouter.get("/download", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const url = process.env.APP_UPDATE_URL ?? "";
  if (/\.apk(\?|$)/i.test(url)) return res.redirect(302, url);
  return res.redirect(302, "https://www.myttm.cl");
});

export default appVersionRouter;
