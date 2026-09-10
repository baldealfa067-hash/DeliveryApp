-- Registar, no proprio esquema, que `deliveries` esta' fechada a' frota DE
-- PROPOSITO. Nao ha' nada a corrigir aqui.
--
-- Decisao do dono do projecto, 2026-09-10.
--
-- A pergunta vai voltar a aparecer, porque a situacao parece um bug: o dono de
-- uma frota abre o painel, ve' as suas entregas e os seus motoristas, mas se
-- alguem consultar `deliveries` directamente com o JWT dele recebe ZERO LINHAS.
-- Foi medido: a policy "Deliveries viewable by involved" cobre o motorista, o
-- cliente, o dono do restaurante e o admin -- e nao o dono da frota.
--
-- Funciona porque as RPCs da frota (get_fleet_metrics, get_fleet_drivers,
-- get_fleet_driver_detail) sao SECURITY DEFINER e saltam o RLS. E' a via
-- deliberada: a frota chega aos seus dados por funcoes que decidem o que expor,
-- em vez de a tabela inteira ficar aberta a mais um papel.
--
-- CONSEQUENCIA PRATICA, e a razao de isto estar escrito: codigo novo no painel
-- da frota que leia `deliveries` directamente NAO da' erro -- devolve uma lista
-- vazia, em silencio. Se precisares de mais um dado do lado da frota,
-- acrescenta-o a uma RPC existente ou cria outra; nao acrescentes uma policy
-- sem falar com o dono do projecto.

COMMENT ON TABLE public.deliveries IS
  'Entregas. NAO e'' legivel directamente pelo dono da frota -- so'' motorista, '
  'cliente, dono do restaurante e admin (ver policy "Deliveries viewable by '
  'involved"). A frota chega aos seus dados pelas RPCs SECURITY DEFINER '
  '(get_fleet_metrics, get_fleet_drivers, get_fleet_driver_detail). E'' '
  'deliberado, decidido em 2026-09-10: uma leitura directa daqui com o JWT da '
  'frota devolve lista vazia SEM ERRO, portanto nao tentes ler a tabela do lado '
  'da frota -- acrescenta o dado a uma RPC.';

COMMENT ON POLICY "Deliveries viewable by involved" ON public.deliveries IS
  'Motorista da entrega, cliente do pedido, dono do restaurante e admin. O dono '
  'da frota esta'' FORA desta lista de proposito (2026-09-10) e chega aos dados '
  'pelas RPCs SECURITY DEFINER da frota.';
