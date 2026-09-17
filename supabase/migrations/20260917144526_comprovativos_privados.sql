-- Comprovativos privados (2026-09-17, aprovado pelo dono).
--
-- 1. Bucket privado `comprovativos`: só se abre por URL assinado. Lê o cliente que
--    enviou, o dono do restaurante do pedido e o admin.
-- 2. Um comprovativo ligado a um pedido não pode ser apagado (nem substituído:
--    não há policy de UPDATE).
-- 3. `create_order` passa a aceitar o NOME do objecto neste bucket, e recusa um
--    comprovativo já usado noutro pedido. Transformação cirúrgica sobre a
--    definição viva, como na migração anterior.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprovativos', 'comprovativos', false, 5242880, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Um comprovativo paga UM pedido. O índice é o travão contra corridas; a
-- verificação em create_order dá a mensagem legível.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_proof_url_unico
  ON public.orders (payment_proof_url) WHERE payment_proof_url IS NOT NULL;

-- SECURITY DEFINER: as policies de storage consultam `orders` e `profiles`, que
-- têm RLS próprio. Lê-las por aqui evita depender (e recursar) nessas policies —
-- a lição da recursão fleets/drivers da Fase 3.
CREATE OR REPLACE FUNCTION public.comprovativo_ligado_a_pedido(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.orders o WHERE o.payment_proof_url = p_name);
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_comprovativo(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    -- quem o enviou (a pasta é o uid, e só o próprio escreve na sua pasta)
    split_part(p_name, '/', 1) = auth.uid()::text
    -- o admin (§55)
    OR public.has_role(auth.uid(), 'admin')
    -- o dono do restaurante do pedido a que o comprovativo está ligado
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.profiles p ON p.id = o.business_id
      WHERE o.payment_proof_url = p_name AND p.user_id = auth.uid()
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.comprovativo_ligado_a_pedido(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pode_ver_comprovativo(text)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.comprovativo_ligado_a_pedido(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pode_ver_comprovativo(text)        TO authenticated;

DROP POLICY IF EXISTS "Comprovativos: cliente envia para a sua pasta" ON storage.objects;
CREATE POLICY "Comprovativos: cliente envia para a sua pasta" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovativos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Comprovativos: cliente, restaurante do pedido e admin leem" ON storage.objects;
CREATE POLICY "Comprovativos: cliente, restaurante do pedido e admin leem" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comprovativos' AND public.pode_ver_comprovativo(name));

DROP POLICY IF EXISTS "Comprovativos: apagar so se nao ligado a pedido" ON storage.objects;
CREATE POLICY "Comprovativos: apagar so se nao ligado a pedido" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'comprovativos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT public.comprovativo_ligado_a_pedido(name)
  );
-- Sem policy de UPDATE para `comprovativos`, de propósito: substituir a imagem de
-- um comprovativo já enviado seria apagá-lo por outra via.

DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
  v_ancora_storage constant text := $a$    -- O comprovativo tem de ser um ficheiro enviado por ESTE cliente para a pasta
    -- de comprovativos dele. Texto solto ("x"), URLs de fora ou o ficheiro de outra
    -- pessoa nao passam.
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects so
      WHERE so.bucket_id = 'portfolio'
        AND so.name = split_part(split_part(p_payment_proof_url, '/storage/v1/object/public/portfolio/', 2), '?', 1)
        AND so.name LIKE auth.uid()::text || '/orders/payment/%'
    ) THEN
      RAISE EXCEPTION 'O comprovativo nao foi encontrado. Anexe a imagem outra vez.';
    END IF;
$a$;
  v_ancora_insert constant text := $b$    CASE WHEN p_payment_method = 'online' THEN p_payment_proof_url END,$b$;
BEGIN
  v_def := pg_get_functiondef('public.create_order(uuid,uuid,text,text,jsonb,numeric,text,text,text,text,double precision,double precision,text,text,text)'::regprocedure);

  IF position(v_ancora_storage IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order: bloco do comprovativo (portfolio) nao encontrado -- a funcao viva mudou';
  END IF;
  IF position(v_ancora_insert IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order: trecho do INSERT do comprovativo nao encontrado -- a funcao viva mudou';
  END IF;

  v_novo := replace(v_def, v_ancora_storage, $c$    -- Comprovativos privados (2026-09-17): o comprovativo e' o NOME do objecto no
    -- bucket privado `comprovativos`, na pasta do proprio cliente. Texto solto, URLs,
    -- ficheiros que nao existem ou de outra pessoa nao passam.
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects so
      WHERE so.bucket_id = 'comprovativos'
        AND so.name = btrim(p_payment_proof_url)
        AND so.name LIKE auth.uid()::text || '/%'
    ) THEN
      RAISE EXCEPTION 'O comprovativo nao foi encontrado. Anexe a imagem outra vez.';
    END IF;

    -- Uma captura paga UM pedido (§73). O indice unico e' o travao; isto e' a mensagem.
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.payment_proof_url = btrim(p_payment_proof_url)) THEN
      RAISE EXCEPTION 'Este comprovativo ja foi usado noutro pedido. Anexe o comprovativo deste pagamento.';
    END IF;
$c$);

  v_novo := replace(v_novo, v_ancora_insert,
    $d$    CASE WHEN p_payment_method = 'online' THEN btrim(p_payment_proof_url) END,$d$);

  EXECUTE v_novo;
END
$migracao$;
