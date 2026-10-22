-- Funciones y garantías manuales que el generador ORM no representa.
CREATE OR REPLACE FUNCTION public.nexo_identity_is_canonical(value bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, public AS $nexo$
DECLARE position integer; point integer; previous integer := -1; size integer := octet_length(value);
BEGIN
  IF size = 0 OR size % 4 <> 0 THEN RETURN false; END IF;
  -- Materializar una sola vez: get_byte vuelve a detoastar entradas comprimidas.
  value := value || ''::bytea;
  FOR position IN 0..(size / 4 - 1) LOOP
    IF get_byte(value, position * 4) <> 0 THEN RETURN false; END IF;
    point := get_byte(value, position * 4 + 1) * 65536
      + get_byte(value, position * 4 + 2) * 256 + get_byte(value, position * 4 + 3);
    IF point > 1114111 OR (previous BETWEEN 55296 AND 56319 AND point BETWEEN 56320 AND 57343) THEN RETURN false; END IF;
    previous := point;
  END LOOP;
  RETURN true;
END;
$nexo$;
