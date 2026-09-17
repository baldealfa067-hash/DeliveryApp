-- Checkout, ponto 4 (2026-09-17) — comprovativo Orange Money obrigatório, e o
-- servidor recusa "pagar agora" num restaurante que não recebe por Orange Money.
--
-- Transformação CIRÚRGICA sobre a definição VIVA de create_order (não sobre um
-- ficheiro — ver a nota "Ficheiro de migração ≠ função viva"). Aborta se algum dos
-- trechos esperados não estiver lá, em vez de instalar uma função meio alterada.
--
-- 1. Depois da validação do método:
--    - online exige restaurante com orange_money_method;
--    - online exige comprovativo que EXISTE no storage, na pasta do próprio cliente:
--      portfolio/<auth.uid()>/orders/payment/<ficheiro>. A policy de storage só deixa
--      cada um escrever na sua pasta, portanto não serve o comprovativo de outro.
-- 2. No INSERT: o comprovativo só é guardado num pedido online.

DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
  v_ancora_metodo constant text := $a$  IF p_payment_method NOT IN ('entrega', 'online') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;
$a$;
  v_ancora_insert constant text := $b$    p_payment_method, p_payment_proof_url, 'pendente',$b$;
BEGIN
  v_def := pg_get_functiondef('public.create_order(uuid,uuid,text,text,jsonb,numeric,text,text,text,text,double precision,double precision,text,text,text)'::regprocedure);

  IF position(v_ancora_metodo IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order: trecho da validacao do metodo nao encontrado -- a funcao viva mudou';
  END IF;
  IF position(v_ancora_insert IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_order: trecho do INSERT do comprovativo nao encontrado -- a funcao viva mudou';
  END IF;
  IF position('orange_money_method' IN v_def) > 0 THEN
    RAISE EXCEPTION 'create_order: ja tem a regra do Orange Money -- migracao aplicada duas vezes?';
  END IF;

  v_novo := replace(v_def, v_ancora_metodo, v_ancora_metodo || $c$
  -- Checkout, ponto 4 (§22, §23, §46): "pagar agora" so onde ha para onde pagar,
  -- e so com comprovativo real. Sem isto, fica a palavra do cliente contra a do
  -- restaurante -- a disputa que o comprovativo existe para evitar.
  IF p_payment_method = 'online' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p_business_id AND pr.orange_money_method IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Este restaurante nao recebe por Orange Money. Escolha pagar na entrega.';
    END IF;

    IF p_payment_proof_url IS NULL OR btrim(p_payment_proof_url) = '' THEN
      RAISE EXCEPTION 'Anexe o comprovativo do pagamento Orange Money antes de fazer o pedido.';
    END IF;

    -- O comprovativo tem de ser um ficheiro enviado por ESTE cliente para a pasta
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
  END IF;
$c$);

  v_novo := replace(v_novo, v_ancora_insert,
    $d$    p_payment_method,
    CASE WHEN p_payment_method = 'online' THEN p_payment_proof_url END,
    'pendente',$d$);

  EXECUTE v_novo;
END
$migracao$;
