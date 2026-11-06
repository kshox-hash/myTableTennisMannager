-- ============================================================
--  084 — Textos en forma compuesta (Unicode NFC)
--
--  Hay nombres guardados con la Ñ y las tildes "descompuestas" (N + tilde
--  combinable U+0303), típico de texto pegado desde Excel o tipeado en
--  iPhone. Se ven bien en pantalla pero rompen los PDF (jsPDF dibujaba la
--  línea entera mal: "MUÑOZ" salía " M U N O Z"), las búsquedas y las
--  comparaciones. Desde ahora el backend normaliza todo texto entrante
--  (normalize_text_middleware); acá se corrige lo que ya estaba guardado.
--
--  Solo toca filas que lo necesitan (IS NOT NFC NORMALIZED). Cada tabla va en
--  su propio bloque: si algo choca con un índice único (dos nombres que
--  quedarían iguales), ese paso se omite y la migración sigue — nunca debe
--  impedir que arranque el servidor.
-- ============================================================

DO $$ BEGIN
  UPDATE users SET
    first_name = normalize(first_name, NFC),
    last_name  = normalize(last_name, NFC)
  WHERE first_name IS NOT NFC NORMALIZED OR last_name IS NOT NFC NORMALIZED;
EXCEPTION WHEN others THEN RAISE NOTICE '084 users (nombre): %', SQLERRM;
END $$;

DO $$ BEGIN
  UPDATE users SET
    organizer_first_name = normalize(organizer_first_name, NFC),
    organizer_last_name  = normalize(organizer_last_name, NFC)
  WHERE organizer_first_name IS NOT NFC NORMALIZED OR organizer_last_name IS NOT NFC NORMALIZED;
EXCEPTION WHEN others THEN RAISE NOTICE '084 users (organizador): %', SQLERRM;
END $$;

DO $$ BEGIN
  UPDATE clubs SET name = normalize(name, NFC) WHERE name IS NOT NFC NORMALIZED;
EXCEPTION WHEN others THEN RAISE NOTICE '084 clubs: %', SQLERRM;
END $$;

DO $$ BEGIN
  UPDATE tournaments SET
    tournament_name = normalize(tournament_name, NFC),
    address         = normalize(address, NFC)
  WHERE tournament_name IS NOT NFC NORMALIZED OR address IS NOT NFC NORMALIZED;
EXCEPTION WHEN others THEN RAISE NOTICE '084 tournaments: %', SQLERRM;
END $$;

DO $$ BEGIN
  UPDATE tournament_categories SET
    category_type  = normalize(category_type, NFC),
    category_range = normalize(category_range, NFC)
  WHERE category_type IS NOT NFC NORMALIZED OR category_range IS NOT NFC NORMALIZED;
EXCEPTION WHEN others THEN RAISE NOTICE '084 categorías: %', SQLERRM;
END $$;
