-- Notas de voz e comprovativos de comissão privados (2026-09-17, aprovado pelo dono).
-- Mesmo desenho dos comprovativos de pedido (20260917144526).
--
--  notas-voz               ouvem: cliente do pedido, dono do restaurante, motorista
--                          ATRIBUÍDO, admin (+ quem enviou)
--  comprovativos-comissao  vêem: quem enviou, admin
--
-- E fecha o buraco que o desenho abria: create_order / create_send_order gravavam a
-- voz sem validar, e com acesso por pedido um cliente punha no seu pedido a voz de
-- outro cliente. Agora a voz tem de ser da pasta do próprio.

-- 1. Buckets ------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('notas-voz', 'notas-voz', false, 10485760, ARRAY['audio/*']),
       ('comprovativos-comissao', 'comprovativos-comissao', false, 5242880, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Quem pode o quê (SECURITY DEFINER: não depender das policies de orders,
--    profiles, deliveries e drivers dentro de uma policy de storage) ------------
CREATE OR REPLACE FUNCTION public.nota_voz_ligada_a_pedido(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.voice_note_url = p_name OR o.pickup_voice_note_url = p_name
  );
$$;

CREATE OR REPLACE FUNCTION public.pode_ouvir_nota_voz(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_name, '/', 1) = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE (o.voice_note_url = p_name OR o.pickup_voice_note_url = p_name)
        AND (
          o.customer_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.business_id AND p.user_id = auth.uid())
          -- motorista ATRIBUÍDO: tem esta entrega. Uma oferta por aceitar não conta.
          OR EXISTS (
            SELECT 1 FROM public.deliveries d
            JOIN public.drivers dr ON dr.id = d.driver_id
            WHERE d.order_id = o.id AND dr.user_id = auth.uid()
          )
        )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.comprovativo_comissao_ligado(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.commission_payments c WHERE c.proof_url = p_name);
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_comprovativo_comissao(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_name, '/', 1) = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.nota_voz_ligada_a_pedido(text)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pode_ouvir_nota_voz(text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.comprovativo_comissao_ligado(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pode_ver_comprovativo_comissao(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nota_voz_ligada_a_pedido(text)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pode_ouvir_nota_voz(text)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comprovativo_comissao_ligado(text)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pode_ver_comprovativo_comissao(text) TO authenticated;

-- 3. Policies de storage (sem UPDATE em nenhum: não se substitui o que já foi enviado)
DROP POLICY IF EXISTS "Notas de voz: cliente envia para a sua pasta" ON storage.objects;
CREATE POLICY "Notas de voz: cliente envia para a sua pasta" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'notas-voz' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Notas de voz: quem participa na entrega ouve" ON storage.objects;
CREATE POLICY "Notas de voz: quem participa na entrega ouve" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'notas-voz' AND public.pode_ouvir_nota_voz(name));

DROP POLICY IF EXISTS "Notas de voz: apagar so se nao ligada a pedido" ON storage.objects;
CREATE POLICY "Notas de voz: apagar so se nao ligada a pedido" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'notas-voz'
         AND (storage.foldername(name))[1] = auth.uid()::text
         AND NOT public.nota_voz_ligada_a_pedido(name));

DROP POLICY IF EXISTS "Comprovativos de comissao: parceiro envia para a sua pasta" ON storage.objects;
CREATE POLICY "Comprovativos de comissao: parceiro envia para a sua pasta" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovativos-comissao' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Comprovativos de comissao: quem enviou e admin veem" ON storage.objects;
CREATE POLICY "Comprovativos de comissao: quem enviou e admin veem" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comprovativos-comissao' AND public.pode_ver_comprovativo_comissao(name));

DROP POLICY IF EXISTS "Comprovativos de comissao: apagar so se nao ligado" ON storage.objects;
CREATE POLICY "Comprovativos de comissao: apagar so se nao ligado" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'comprovativos-comissao'
         AND (storage.foldername(name))[1] = auth.uid()::text
         AND NOT public.comprovativo_comissao_ligado(name));

-- 4. A voz de um pedido tem de ser do próprio cliente --------------------------
-- Aceita (a) o nome de um objecto em notas-voz na pasta de quem chama, e
-- (b) TRANSIÇÃO: a URL pública antiga do portfolio, se o ficheiro existir e for da
-- pasta de quem chama (janela até ao deploy do frontend, e bundles em cache).
-- Sem GRANT a ninguém: só as funções de criação de pedido a chamam, e aberta
-- servia de oráculo para saber se um ficheiro existe.
CREATE OR REPLACE FUNCTION public.assert_nota_voz_do_proprio(p_ref text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ref  text := NULLIF(btrim(COALESCE(p_ref, '')), '');
  v_nome text;
BEGIN
  IF v_ref IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  IF v_ref LIKE '%/storage/v1/object/public/portfolio/%' THEN
    v_nome := split_part(split_part(v_ref, '/storage/v1/object/public/portfolio/', 2), '?', 1);
    IF EXISTS (SELECT 1 FROM storage.objects so
               WHERE so.bucket_id = 'portfolio' AND so.name = v_nome
                 AND so.name LIKE auth.uid()::text || '/%') THEN
      RETURN;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM storage.objects so
                WHERE so.bucket_id = 'notas-voz' AND so.name = v_ref
                  AND so.name LIKE auth.uid()::text || '/%') THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'A indicacao de voz nao foi encontrada. Grave outra vez.';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assert_nota_voz_do_proprio(text) FROM PUBLIC, anon, authenticated;

-- 5. create_order: valida a voz e grava-a aparada (transformação cirúrgica) -----
DO $migracao$
DECLARE
  v_def text; v_novo text;
  v_ancora_itens  constant text := $a$  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
$a$;
  v_ancora_insert constant text := $b$    CASE WHEN p_consumption_option = 'entrega' THEN p_voice_note_url ELSE NULL END,
$b$;
BEGIN
  v_def := pg_get_functiondef('public.create_order(uuid,uuid,text,text,jsonb,numeric,text,text,text,text,double precision,double precision,text,text,text)'::regprocedure);
  IF position('assert_nota_voz_do_proprio' IN v_def) > 0 THEN
    RAISE EXCEPTION 'create_order: ja valida a voz -- migracao aplicada duas vezes?';
  END IF;
  IF position(v_ancora_itens IN v_def) = 0 OR position(v_ancora_insert IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order: trechos esperados nao encontrados -- a funcao viva mudou';
  END IF;
  v_novo := replace(v_def, v_ancora_itens, $c$  -- A voz tem de ser do proprio cliente: o acesso a ela passa a depender do pedido.
  IF p_consumption_option = 'entrega' THEN
    PERFORM public.assert_nota_voz_do_proprio(p_voice_note_url);
  END IF;

$c$ || v_ancora_itens);
  v_novo := replace(v_novo, v_ancora_insert,
    $d$    CASE WHEN p_consumption_option = 'entrega' THEN NULLIF(btrim(COALESCE(p_voice_note_url, '')), '') ELSE NULL END,
$d$);
  EXECUTE v_novo;
END
$migracao$;

-- 6. create_send_order: as duas vozes -------------------------------------------
DO $migracao$
DECLARE
  v_def text; v_novo text;
  v_ancora_frota   constant text := $a$  SELECT gp.fleet_id, gp.fleet_name, gp.preco
  INTO v_fleet_id, v_fleet_name, v_preco
$a$;
  v_ancora_destino constant text := $b$    btrim(p_address), btrim(p_bairro), p_customer_lat, p_customer_lng, p_voice_note_url,
$b$;
  v_ancora_recolha constant text := $c$    p_pickup_lat, p_pickup_lng, p_pickup_voice_note_url,
$c$;
BEGIN
  v_def := pg_get_functiondef('public.create_send_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,double precision,text)'::regprocedure);
  IF position('assert_nota_voz_do_proprio' IN v_def) > 0 THEN
    RAISE EXCEPTION 'create_send_order: ja valida a voz -- migracao aplicada duas vezes?';
  END IF;
  IF position(v_ancora_frota IN v_def) = 0 OR position(v_ancora_destino IN v_def) = 0 OR position(v_ancora_recolha IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_send_order: trechos esperados nao encontrados -- a funcao viva mudou';
  END IF;
  v_novo := replace(v_def, v_ancora_frota, $d$  -- As duas vozes tem de ser do proprio cliente (ver create_order).
  PERFORM public.assert_nota_voz_do_proprio(p_pickup_voice_note_url);
  PERFORM public.assert_nota_voz_do_proprio(p_voice_note_url);

$d$ || v_ancora_frota);
  v_novo := replace(v_novo, v_ancora_destino,
    $e$    btrim(p_address), btrim(p_bairro), p_customer_lat, p_customer_lng, NULLIF(btrim(COALESCE(p_voice_note_url, '')), ''),
$e$);
  v_novo := replace(v_novo, v_ancora_recolha,
    $f$    p_pickup_lat, p_pickup_lng, NULLIF(btrim(COALESCE(p_pickup_voice_note_url, '')), ''),
$f$);
  EXECUTE v_novo;
END
$migracao$;

-- 7. commission_payments: o comprovativo tem de ser de quem paga -----------------
CREATE UNIQUE INDEX IF NOT EXISTS commission_payments_proof_url_unico
  ON public.commission_payments (proof_url);

CREATE OR REPLACE FUNCTION public.tg_comprovativo_comissao_valido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Sem sessão (chave de serviço, migrações): não há "próprio" a verificar.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.proof_url IS DISTINCT FROM OLD.proof_url THEN
      RAISE EXCEPTION 'O comprovativo de um pagamento ja enviado nao se altera';
    END IF;
    RETURN NEW;
  END IF;

  NEW.proof_url := btrim(COALESCE(NEW.proof_url, ''));
  IF NOT EXISTS (SELECT 1 FROM storage.objects so
                 WHERE so.bucket_id = 'comprovativos-comissao' AND so.name = NEW.proof_url
                   AND so.name LIKE auth.uid()::text || '/%') THEN
    RAISE EXCEPTION 'O comprovativo nao foi encontrado. Anexe a imagem outra vez.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_payments c WHERE c.proof_url = NEW.proof_url) THEN
    RAISE EXCEPTION 'Este comprovativo ja foi usado noutro pagamento. Anexe o comprovativo deste pagamento.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tg_comprovativo_comissao_valido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS comprovativo_comissao_valido ON public.commission_payments;
CREATE TRIGGER comprovativo_comissao_valido
  BEFORE INSERT OR UPDATE OF proof_url ON public.commission_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_comprovativo_comissao_valido();
