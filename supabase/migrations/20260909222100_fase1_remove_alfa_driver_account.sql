-- FASE 1 (fecho) -- remocao total da conta de teste `alfa` (telefone 957107795).
--
-- Decisao do dono do projecto (2026-09-09), explicita e depois de lhe ter sido
-- devolvida a questao em 20260909162957: apagar tudo. Entregas, comprovativo,
-- linha de motorista, conta de login e papeis -- incluindo o papel de admin.
-- E' dado de teste; contas novas serao criadas quando for preciso testar.
--
-- POR QUE NAO SE MUDA A FK PARA ON DELETE CASCADE
-- A alternativa oferecida era por `deliveries_driver_id_fkey` e
-- `delivery_proofs_driver_id_fkey` em CASCADE. Nao se faz: seria uma regra
-- permanente do esquema para resolver uma limpeza pontual, e passaria a apagar
-- silenciosamente historico de entregas e provas sempre que um motorista fosse
-- removido -- exactamente o que §56 e §74 proibem. Apaga-se pela ordem certa,
-- uma vez, e as FKs continuam a proteger o historico no futuro.
--
-- ORDEM (das folhas para a raiz):
--   delivery_proofs -> deliveries -> drivers -> user_roles -> profiles -> auth.users
--
-- O QUE **NAO** SE APAGA, DE PROPOSITO:
--   - os 9 `orders` servidos por estas entregas. Nao foram pedidos para apagar,
--     e sao pedidos de clientes, nao dados do motorista. Ficam em `concluido`
--     sem linha de entrega associada -- consequencia aceite e registada aqui.
--   - `order_status_history`. E' rasto de auditoria (§56/§74).
--   - `platform_settings.updated_by` e as validacoes de pagamento feitas por
--     esta conta admin: sao registos financeiros. A referencia passa a NULL,
--     a linha fica. Apagar a linha seria reescrever o historico financeiro.
--
-- NOTA SOBRE CASCATA: `orders.customer_id` nao tem foreign key nenhuma, por isso
-- apagar o utilizador NAO arrasta pedidos que `alfa` tenha feito como cliente --
-- ficam com um `customer_id` orfao. As 13 tabelas que apontam a `profiles(id)`
-- com ON DELETE CASCADE sao todas de negocio (menus, produtos, marcacoes); `alfa`
-- nao e' um negocio, portanto nao ha nada a cascatear a' partida. Se houver,
-- o bloco falha e faz rollback inteiro -- e' transaccional de proposito.

DO $$
DECLARE
  v_driver_id uuid;
  v_user_id   uuid;
  v_profile_id uuid;
  v_deliveries int;
  v_proofs     int;
BEGIN
  SELECT id, user_id INTO v_driver_id, v_user_id
  FROM public.drivers WHERE phone = '957107795';

  IF v_driver_id IS NULL THEN
    RAISE NOTICE 'Motorista 957107795 nao encontrado -- nada a fazer.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_deliveries FROM public.deliveries    WHERE driver_id = v_driver_id;
  SELECT count(*) INTO v_proofs     FROM public.delivery_proofs WHERE driver_id = v_driver_id;
  RAISE NOTICE 'alfa: driver=% user=% entregas=% provas=%',
    v_driver_id, v_user_id, v_deliveries, v_proofs;

  DELETE FROM public.delivery_proofs WHERE driver_id = v_driver_id;
  DELETE FROM public.deliveries      WHERE driver_id = v_driver_id;
  DELETE FROM public.drivers         WHERE id        = v_driver_id;

  IF v_user_id IS NOT NULL THEN
    -- Soltar as referencias de auditoria financeira antes de apagar o utilizador.
    UPDATE public.platform_settings SET updated_by = NULL WHERE updated_by = v_user_id;
    UPDATE public.commission_payments SET validated_by = NULL WHERE validated_by = v_user_id;

    DELETE FROM public.user_roles WHERE user_id = v_user_id;

    SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_user_id;
    IF v_profile_id IS NOT NULL THEN
      DELETE FROM public.profiles WHERE id = v_profile_id;
    END IF;

    DELETE FROM auth.users WHERE id = v_user_id;
  END IF;

  RAISE NOTICE 'alfa removida por completo.';
END $$;
