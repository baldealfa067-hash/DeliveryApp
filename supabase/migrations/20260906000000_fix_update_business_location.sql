-- update_business_location comparava profiles.id (chave gerada por gen_random_uuid())
-- com auth.uid(), quando a coluna que liga o perfil ao utilizador autenticado é
-- profiles.user_id. O WHERE nunca correspondia a nenhuma linha, logo o UPDATE
-- afetava 0 linhas sem gerar erro: a localização do restaurante nunca era
-- gravada via esta RPC, deixando profiles.lat/lng a NULL e bloqueando
-- silenciosamente a criação automática de entregas em update_order_status
-- (ramo "coordenadas em falta").
CREATE OR REPLACE FUNCTION public.update_business_location(
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET lat = p_lat, lng = p_lng
  WHERE user_id = auth.uid() AND profile_type = 'business';
END;
$$;
