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
    // sitio de terceros). Restringido al/los origen(es) real(es) del frontend.
    //
    // Los dominios conocidos viven acá. Para agregar otros SIN tocar código
    // (ej. un dominio de la Federación más adelante) hay dos variables de
    // entorno, ambas OPCIONALES y ADITIVAS (se suman a esta lista, no la
    // reemplazan) — se aceptan las dos con el mismo formato:
    //   CORS_ORIGINS       = https://uno.cl,https://dos.cl
    //   ALLOWED_ORIGINS    = https://uno.cl,https://dos.cl   (alias histórico)
    // Formato de cada valor: origen completo con esquema, separados por coma,
    // SIN barra final y SIN ruta. Ej: "https://www.myttm.cl" (no
    // "https://www.myttm.cl/" ni "www.myttm.cl").
    const defaultOrigins = [
        "https://www.my-ttm.com",           // producción (dominio propio)
        "https://my-ttm.com",               // producción (dominio propio, sin www)
        "https://www.myttm.cl",             // producción (dominio .cl)
        "https://myttm.cl",                 // producción (dominio .cl, sin www)
        "https://elevenmatch.onrender.com", // producción (subdominio de Render, por si se sigue usando)
        "http://localhost:5173",            // Vite dev server
        "http://localhost:4173",            // vite preview
    ];
    const parseOriginList = (raw: string | undefined): string[] =>
        (raw ?? "")
            .split(",")
            .map((o) => o.trim().replace(/\/+$/, "")) // saca barra(s) final(es)
            .filter(Boolean);

    const allowedOrigins = Array.from(new Set([
        ...defaultOrigins,
        ...parseOriginList(process.env.CORS_ORIGINS),
        ...parseOriginList(process.env.ALLOWED_ORIGINS),
    ]));

    app.use(cors({
        origin(origin, callback) {
            // Sin header Origin (curl, apps móviles, server-to-server) — permitir.
            if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
                return callback(null, true);
            }
            return callback(new Error("Origen no permitido por CORS"));
        },
    }));
    app.use(helmet());
}
