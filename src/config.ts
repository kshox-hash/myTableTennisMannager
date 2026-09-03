import express from "express";
import helmet  from "helmet";
import cors from "cors";

export default (app : express.Express) => {
    app.disable("x-powered-by");

    app.use(express.json());
    app.use(express.urlencoded({ extended : true}));

    // Antes cors() sin opciones reflejaba CUALQUIER origen (Access-Control-Allow-Origin: *
    // efectivo). No era explotable para robar el token porque la API es
    // Bearer-only (nunca usa cookies), pero sí dejaba que cualquier sitio
    // hiciera fetch() directo a la API desde el navegador de un usuario
    // logueado si de algún otro modo conseguía el token (ej. XSS en un
    // sitio de terceros). Restringido al/los origen(es) real(es) del
    // frontend. ALLOWED_ORIGINS permite agregar otros sin tocar código
    // (ej. un dominio propio de la Federación más adelante).
    const defaultOrigins = [
        "https://elevenmatch.onrender.com", // producción (Render static site)
        "http://localhost:5173",            // Vite dev server
        "http://localhost:4173",            // vite preview
    ];
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
        : defaultOrigins;

    app.use(cors({
        origin(origin, callback) {
            // Sin header Origin (curl, apps móviles, server-to-server) — permitir.
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error("Origen no permitido por CORS"));
        },
    }));
    app.use(helmet());
}
