-- FASE 1 -- remover as contas de motorista de teste.
--
-- Aprovado pelo dono do projecto: apagar as quatro. Executam-se aqui TRES; a
-- quarta (`alfa`) fica de fora por uma razao tecnica, nao por opiniao:
--
--   deliveries_driver_id_fkey      ON DELETE NO ACTION
--   delivery_proofs_driver_id_fkey ON DELETE NO ACTION
--
-- e `alfa` tem 9 entregas e 1 comprovativo a apontar-lhe. O Postgres RECUSA o
-- DELETE. Nao ha forma de o executar sem primeiro decidir o que fazer a esses
-- registos, e essa decisao ainda nao foi tomada -- fica documentada na
-- auditoria e devolvida ao dono do projecto.
--
-- Estas tres nao tem uma unica entrega, comprovativo ou seguimento associado,
-- portanto saem sem arrastar nada atras:
--   Test2       955123457  BAAL-DC3D-EAC8  papel: client
--   Alfa Balde  967104489  BAAL-92F9-7606  papel: client
--   Motorista D 955000001  (sem bornaal_id, sem papel nenhum -- linha orfa)
--
-- AMBITO: apaga-se a LINHA DE MOTORISTA, nao a conta de utilizador. Deixam de
-- ser motoristas; a conta em auth.users e os papeis em user_roles ficam. Apagar
-- utilizadores e' outra operacao, com outras consequencias, e nao foi pedida.
DELETE FROM public.drivers
WHERE phone IN ('955123457', '967104489', '955000001')
  AND NOT EXISTS (SELECT 1 FROM public.deliveries dl WHERE dl.driver_id = drivers.id)
  AND NOT EXISTS (SELECT 1 FROM public.delivery_proofs pr WHERE pr.driver_id = drivers.id);
