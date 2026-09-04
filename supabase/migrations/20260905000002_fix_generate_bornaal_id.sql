CREATE OR REPLACE FUNCTION public.generate_bornaal_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_id text;
  v_exists boolean := true;
BEGIN
  WHILE v_exists LOOP
    v_id := 'BAAL-' ||
      upper(encode(extensions.gen_random_bytes(2), 'hex')) || '-' ||
      upper(encode(extensions.gen_random_bytes(2), 'hex'));
    v_id := substring(v_id from 1 for 14);
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE bornaal_id = v_id) INTO v_exists;
  END LOOP;
  RETURN v_id;
END;
$$;
