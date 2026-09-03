
-- Drop all relevant FKs
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_user_id_fkey;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_provider_id_fkey;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

-- Insert digital service providers
INSERT INTO public.profiles (id, user_id, name, category, phone, location, description, photo_url)
VALUES
  ('b2c3d4e5-2222-4bbb-cccc-000000000001', 'b2c3d4e5-2222-4bbb-cccc-100000000001', 'Amílcar Mendes', 'Serviços Digitais', '+245 966 111 001', 'Bissau', 'Designer gráfico especializado em criação de logos, flyers, branding e identidade visual para empresas e eventos.', '/avatars/amilcar.jpg'),
  ('b2c3d4e5-2222-4bbb-cccc-000000000002', 'b2c3d4e5-2222-4bbb-cccc-100000000002', 'Mariama Djaló', 'Serviços Digitais', '+245 966 111 002', 'Bissau', 'Editora de vídeo profissional para redes sociais, eventos, casamentos e conteúdo promocional.', '/avatars/mariama.jpg'),
  ('b2c3d4e5-2222-4bbb-cccc-000000000003', 'b2c3d4e5-2222-4bbb-cccc-100000000003', 'Paulo Sanhá', 'Serviços Digitais', '+245 966 111 003', 'Bissau', 'Gestor de redes sociais e marketing digital. Gestão de Instagram, Facebook e TikTok para negócios.', '/avatars/paulo.jpg'),
  ('b2c3d4e5-2222-4bbb-cccc-000000000004', 'b2c3d4e5-2222-4bbb-cccc-100000000004', 'Satu Baldé', 'Serviços Digitais', '+245 966 111 004', 'Bissau', 'Desenvolvedora web especializada em criação de sites, landing pages e aplicações web modernas.', '/avatars/satu.jpg');

-- Insert reviews
INSERT INTO public.reviews (id, user_id, provider_id, rating, comment)
VALUES
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000001', 'b2c3d4e5-2222-4bbb-cccc-000000000001', 5, 'Excelente designer! Fez o logo da minha empresa com muita criatividade.'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000002', 'b2c3d4e5-2222-4bbb-cccc-000000000001', 4, 'Bom trabalho, entregou no prazo.'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000003', 'b2c3d4e5-2222-4bbb-cccc-000000000002', 5, 'Vídeo do meu casamento ficou incrível!'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000004', 'b2c3d4e5-2222-4bbb-cccc-000000000002', 5, 'Muito profissional e criativa.'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000005', 'b2c3d4e5-2222-4bbb-cccc-000000000003', 4, 'As nossas redes sociais melhoraram muito!'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000001', 'b2c3d4e5-2222-4bbb-cccc-000000000003', 5, 'Recomendo para qualquer negócio.'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000002', 'b2c3d4e5-2222-4bbb-cccc-000000000004', 5, 'O site ficou moderno e rápido.'),
  (gen_random_uuid(), 'a1b2c3d4-aaaa-4aaa-aaaa-000000000003', 'b2c3d4e5-2222-4bbb-cccc-000000000004', 4, 'Boa comunicação e resultado final excelente.');

-- Re-add FKs without validation to keep seed data
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) NOT VALID;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) NOT VALID;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.profiles(id) NOT VALID;
