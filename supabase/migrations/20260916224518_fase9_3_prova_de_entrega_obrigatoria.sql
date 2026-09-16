-- FASE 9.3 -- prova de entrega obrigatoria: codigo OU foto (§37).
--
-- DECISAO DO DONO DO PROJECTO (2026-09-16), no CLAUDE.md: codigo OU foto
-- obrigatorios, imposto no backend. O motorista tem sempre uma saida se um dos
-- metodos falhar (telemovel do cliente sem bateria, sem rede).
--
-- ===========================================================================
-- PORQUE UM TRIGGER, e nao so esconder o botao
-- ===========================================================================
-- A auditoria encontrou SEIS caminhos para uma entrega chegar a `concluido`, e
-- so um deles exigia prova de verdade:
--
--   1. botao "Sem codigo" -> complete_delivery ......... sem prova
--   2. create_delivery_proof(..., qr_validated=true) ... o CLIENTE declarava
--                                                        que tinha validado
--   3. validate_delivery_code com o codigo certo ....... com prova
--   4. foto -> complete_delivery ....................... nao verificava a foto
--   5. motorista -> update_order_status('concluido') ... sem prova
--   6. restaurante -> update_order_status('concluido') . sem prova (fallback)
--
-- Esconder o botao fechava um em seis. A regra vai para UM so sitio que os
-- apanha a todos: um trigger BEFORE UPDATE em `orders` que recusa `concluido`
-- numa entrega sem prova valida. Corre ANTES do trigger AFTER do ledger, por
-- isso uma recusa aborta a transaccao e nada chega a ser lancado -- nem divida
-- de comida, nem comissao, para uma entrega que nada prova ter acontecido
-- (§86, prioridade 2).
--
-- O CASO 6 E UMA MUDANCA DE COMPORTAMENTO. O restaurante perde o fallback de
-- concluir a entrega por conta do motorista. E a leitura fiel da decisao: o
-- restaurante nao esta na entrega e nao a pode provar. A saida que resta, para
-- quando o motorista fica sem telemovel nenhum, e a valvula do admin -- que
-- fica registada no historico.

-- ---------------------------------------------------------------------------
-- 1. Limite de tentativas do codigo
-- ---------------------------------------------------------------------------
-- 6 digitos, tentativas ilimitadas e uma resposta verdadeiro/falso sao um
-- oraculo. Cinco erros bloqueiam o codigo para ESTA entrega -- e nao bloqueiam
-- a entrega: o motorista continua a poder usar a foto. E isso que faz o limite
-- nao ser um beco sem saida.
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS code_attempts smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.deliveries.code_attempts IS
  'Tentativas erradas do codigo de entrega (Fase 9.3). Ao 5o erro o codigo fica '
  'bloqueado para esta entrega; a prova passa a ter de ser por fotografia.';

-- ---------------------------------------------------------------------------
-- 2. O que conta como prova
-- ---------------------------------------------------------------------------
-- Uma so definicao, usada pelo trigger e pela RPC de leitura. Um codigo so
-- conta se foi validado PELO SERVIDOR (`qr_validated`, escrito apenas por
-- validate_delivery_code). Uma foto so conta se parecer uma imagem -- sem isto,
-- create_delivery_proof(id, 'x') passava a contar como prova.
CREATE OR REPLACE FUNCTION public.tem_prova_de_entrega(p_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_proofs pr
    WHERE pr.order_id = p_order_id
      AND (
        pr.qr_validated = true
        OR (pr.photo_url IS NOT NULL
            AND length(pr.photo_url) > 100
            AND (pr.photo_url LIKE 'data:image/%' OR pr.photo_url LIKE 'https://%'))
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.tem_prova_de_entrega(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tem_prova_de_entrega(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. O trigger -- a regra num so sitio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_exige_prova_de_entrega()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.consumption_option = 'entrega'
     -- auth.uid() NULL = sem pedido HTTP por tras: migracoes e trabalhos de
     -- fundo. Nenhum caminho de utilizador chega aqui sem sessao.
     AND auth.uid() IS NOT NULL
     -- A valvula do admin (§36) continua a existir: e a saida para quando o
     -- motorista fica sem telemovel nenhum, e fica registada no historico.
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.tem_prova_de_entrega(NEW.id)
  THEN
    RAISE EXCEPTION
      'Nao e possivel concluir a entrega sem prova: valide o codigo do cliente ou tire uma fotografia'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_exige_prova_de_entrega() IS
  'Fase 9.3: nenhuma entrega passa a concluido sem codigo validado pelo servidor '
  'ou fotografia (§37). BEFORE UPDATE -- corre antes do trigger do ledger, por '
  'isso uma recusa nao lanca nada. Excepcoes: admin (valvula) e ausencia de '
  'sessao (migracoes/trabalhos de fundo).';

DROP TRIGGER IF EXISTS exige_prova_de_entrega ON public.orders;
CREATE TRIGGER exige_prova_de_entrega
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_exige_prova_de_entrega();

-- ---------------------------------------------------------------------------
-- 4. create_delivery_proof deixa de aceitar `qr_validated` do cliente
-- ---------------------------------------------------------------------------
-- Era o furo mais grave: um motorista chamava create_delivery_proof(id, '',
-- true), declarava o codigo validado sem codigo nenhum, e a funcao concluia a
-- entrega sozinha. O parametro fica na assinatura (o frontend manda-o), mas e
-- IGNORADO: quem escreve qr_validated=true e so validate_delivery_code, depois
-- de comparar o codigo. Esta funcao so regista fotografias, e nao conclui --
-- concluir e do complete_delivery, que o trigger vigia.
CREATE OR REPLACE FUNCTION public.create_delivery_proof(
  p_delivery_id uuid, p_photo_url text, p_qr_validated boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proof_id  uuid;
  v_order_id  uuid;
  v_driver_id uuid;
BEGIN
  SELECT d.order_id, d.driver_id INTO v_order_id, v_driver_id
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
    AND d.status IN ('recolhido', 'em_entrega');

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Entrega nao encontrada ou sem permissao';
  END IF;

  IF p_photo_url IS NULL OR length(p_photo_url) <= 100
     OR NOT (p_photo_url LIKE 'data:image/%' OR p_photo_url LIKE 'https://%') THEN
    RAISE EXCEPTION 'Fotografia invalida';
  END IF;

  -- ~2,5 MB em base64. A foto e comprimida no telemovel antes de chegar aqui;
  -- isto so impede que uma imagem por comprimir encha a tabela.
  IF length(p_photo_url) > 3500000 THEN
    RAISE EXCEPTION 'Fotografia demasiado grande';
  END IF;

  INSERT INTO public.delivery_proofs (delivery_id, order_id, driver_id, photo_url, qr_validated, validated_at)
  VALUES (p_delivery_id, v_order_id, v_driver_id, p_photo_url, false, NULL)
  RETURNING id INTO v_proof_id;

  RETURN v_proof_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_delivery_proof(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_delivery_proof(uuid, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. validate_delivery_code -- regista a prova, e tem limite
-- ---------------------------------------------------------------------------
-- Antes chamava complete_delivery sem deixar rasto nenhum da validacao. Agora
-- escreve a prova (qr_validated=true) e so depois conclui, para o trigger a
-- encontrar.
--
-- A ORDEM IMPORTA NO LIMITE: verifica-se o bloqueio ANTES de qualquer escrita, e
-- o erro so incrementa e devolve false -- sem RAISE, porque um RAISE depois do
-- incremento desfazia o proprio incremento e o limite nunca subia.
CREATE OR REPLACE FUNCTION public.validate_delivery_code(p_delivery_id uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id    uuid;
  v_driver_id   uuid;
  v_tentativas  smallint;
  v_stored_code text;
BEGIN
  SELECT d.order_id, d.driver_id, d.code_attempts
  INTO v_order_id, v_driver_id, v_tentativas
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
    AND d.status = 'recolhido'
  FOR UPDATE;

  IF v_order_id IS NULL THEN RETURN false; END IF;

  IF v_tentativas >= 5 THEN
    RAISE EXCEPTION 'Codigo bloqueado apos 5 tentativas erradas: confirme a entrega com uma fotografia';
  END IF;

  SELECT delivery_code INTO v_stored_code FROM public.orders WHERE id = v_order_id;

  IF v_stored_code IS NULL OR v_stored_code <> btrim(COALESCE(p_code, '')) THEN
    UPDATE public.deliveries SET code_attempts = code_attempts + 1 WHERE id = p_delivery_id;
    RETURN false;
  END IF;

  INSERT INTO public.delivery_proofs (delivery_id, order_id, driver_id, photo_url, qr_validated, validated_at)
  VALUES (p_delivery_id, v_order_id, v_driver_id, NULL, true, now());

  PERFORM public.complete_delivery(p_delivery_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_delivery_code(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.validate_delivery_code(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Ler a prova -- cliente, restaurante, frota, motorista, admin
-- ---------------------------------------------------------------------------
-- §37: a prova so vale se alguem a puder ver depois. A tabela ja tinha policy
-- de leitura para motorista/cliente/restaurante/admin, mas nenhum ecra a lia.
-- A FROTA fica fora da tabela, pela decisao de 2026-09-10, e chega a prova por
-- aqui -- como a todos os seus outros dados.
CREATE OR REPLACE FUNCTION public.get_delivery_proof(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ok   boolean;
  v_prova record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao'; END IF;

  SELECT
    public.has_role(auth.uid(), 'admin')
    OR o.customer_id = auth.uid()
    OR public.is_business_owner(o.business_id)
    OR public.owns_fleet(o.fleet_id)
    OR EXISTS (SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
               WHERE d.order_id = o.id AND dr.user_id = auth.uid())
  INTO v_ok
  FROM public.orders o WHERE o.id = p_order_id;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Sem acesso a este pedido';
  END IF;

  -- A mais forte primeiro: codigo validado vale mais do que foto.
  SELECT pr.qr_validated, pr.photo_url, pr.validated_at, pr.created_at
  INTO v_prova
  FROM public.delivery_proofs pr
  WHERE pr.order_id = p_order_id
  ORDER BY pr.qr_validated DESC, pr.created_at DESC
  LIMIT 1;

  IF v_prova IS NULL THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'tipo', CASE WHEN v_prova.qr_validated THEN 'codigo' ELSE 'foto' END,
    'foto', CASE WHEN v_prova.qr_validated THEN NULL ELSE v_prova.photo_url END,
    'registada_em', COALESCE(v_prova.validated_at, v_prova.created_at)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_delivery_proof(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_delivery_proof(uuid) TO authenticated;
