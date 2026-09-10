-- profiles.user_id nunca teve chave estrangeira para auth.users. Resultado: cada
-- utilizador de teste apagado deixava para tras um perfil orfao, visivel na
-- listagem publica (a politica de SELECT e `true`) e impossivel de gerir, porque
-- nenhuma sessao correspondia ao user_id. Estavam 12 assim, todos de contas de
-- teste ("Motor B/C/D", "Resto B", "Cliente Teste"...), sem uma unica linha
-- dependente em nenhuma outra tabela. Foram apagados antes desta migracao.
--
-- ON DELETE CASCADE segue a convencao ja usada em user_roles, notifications,
-- push_subscriptions e service_requests.
--
-- Consequencia a ter presente: apagar um utilizador passa a apagar tambem o seu
-- perfil e, em cascata, tudo o que lhe esta ligado (pedidos, menu, estatisticas).
-- reviews e commission_payments continuam NO ACTION, portanto um perfil com
-- avaliacoes ou pagamentos de comissao recusa ser apagado em vez de os perder.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
