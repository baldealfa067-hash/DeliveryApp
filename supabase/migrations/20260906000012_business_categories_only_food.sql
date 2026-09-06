-- business_categories só com categorias de restauração.
--
-- A tabela tinha sido semeada com uma lista genérica de "qualquer tipo de loja"
-- do tempo em que o app tinha as verticais de Serviços e Beleza. Quando essas
-- saíram, as categorias delas ficaram — e apareciam na grelha de categorias do
-- ecrã de restaurantes, a par de Restaurante e Churrasqueira:
-- Cabeleireiro e Salão, Farmácia, Loja de Calçado/Eletrónica/Roupa/Telemóveis.
--
-- Saem também Mercearia, Supermercado, Talho e Peixaria: vendem comida mas são
-- lojas, não sítios onde se come, e o ecrã chama-se "Restaurantes".
--
-- Seguro: profiles.category é texto e não tem chave estrangeira para aqui, e
-- das 15 linhas só "Restaurante" estava em uso (2 perfis), que se mantém.
-- Qualquer uma pode voltar pelo painel de administrador, que já gere esta tabela.

DELETE FROM public.business_categories
WHERE name NOT IN (
  'Restaurante',
  'Cafetaria',
  'Churrasqueira',
  'Lanchonete',
  'Pastelaria e Padaria'
);
