-- Admin: eliminar utilizador + perfil de forma completa.
-- O painel de admin antes só apagava a linha em profiles, deixando o
-- email preso em auth.users ("User already registered" / login inválido).
-- Este RPC, só para admins, apaga o utilizador de auth.users; a FK
-- profiles.user_id ON DELETE CASCADE remove o perfil e todos os dados
-- associados (avaliações, pedidos, atividade, menu, etc.).

create or replace function public.admin_delete_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Sem permissão de administrador';
  end if;

  select user_id into v_user_id
  from public.profiles
  where id = p_profile_id;

  if v_user_id is null then
    raise exception 'Perfil não encontrado';
  end if;

  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;