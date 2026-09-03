-- Categorias próprias para Restaurantes/Lojas (perfis profile_type='business')
-- para a nova organização da página Explorar (escolha Prestadores vs Lojas).

create table if not exists public.business_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.business_categories enable row level security;

create policy "business_categories public read"
  on public.business_categories for select using (true);
create policy "business_categories admin insert"
  on public.business_categories for insert with check (public.has_role(auth.uid(), 'admin'));
create policy "business_categories admin update"
  on public.business_categories for update using (public.has_role(auth.uid(), 'admin'));
create policy "business_categories admin delete"
  on public.business_categories for delete using (public.has_role(auth.uid(), 'admin'));

insert into public.business_categories (name) values
  ('Restaurante'),
  ('Churrasqueira'),
  ('Lanchonete'),
  ('Pastelaria e Padaria'),
  ('Cafetaria'),
  ('Mercearia'),
  ('Supermercado'),
  ('Talho'),
  ('Peixaria'),
  ('Loja de Roupa'),
  ('Loja de Calçado'),
  ('Loja de Eletrónica'),
  ('Loja de Telemóveis'),
  ('Cabeleireiro e Salão'),
  ('Farmácia')
on conflict (name) do nothing;

alter publication supabase_realtime add table public.business_categories;