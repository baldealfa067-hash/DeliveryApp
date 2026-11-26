INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('delivery-contact-images', 'delivery-contact-images', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp']);

CREATE FUNCTION public.owns_delivery_contact_image(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.owner_user_id = (SELECT auth.uid()) AND p_path = 'fleet/' || f.id::text
  ) OR EXISTS (
    SELECT 1 FROM public.drivers dr
    WHERE dr.user_id = (SELECT auth.uid()) AND dr.fleet_id IS NULL AND p_path = 'driver/' || dr.id::text
  );
$$;

CREATE FUNCTION public.get_delivery_contact_image(p_order_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN d.fleet_id IS NULL THEN 'driver/' || d.driver_id::text
              ELSE 'fleet/' || d.fleet_id::text END
  FROM public.orders o
  JOIN public.deliveries d ON d.order_id = o.id
  WHERE o.id = p_order_id AND o.customer_id = (SELECT auth.uid())
    AND o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
    AND d.status IN ('aceite', 'recolhido', 'em_entrega') AND d.driver_id IS NOT NULL
  ORDER BY d.accepted_at DESC NULLS LAST, d.created_at DESC, d.id DESC
  LIMIT 1;
$$;

CREATE FUNCTION public.can_read_delivery_contact_image(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.owns_delivery_contact_image(p_path) OR EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.deliveries d ON d.order_id = o.id
    WHERE o.customer_id = (SELECT auth.uid())
      AND o.status IN ('motorista_encontrado', 'pedido_recolhido', 'a_caminho')
      AND d.status IN ('aceite', 'recolhido', 'em_entrega') AND d.driver_id IS NOT NULL
      AND p_path = CASE WHEN d.fleet_id IS NULL THEN 'driver/' || d.driver_id::text
                        ELSE 'fleet/' || d.fleet_id::text END
  );
$$;

REVOKE ALL ON FUNCTION public.owns_delivery_contact_image(text),
  public.get_delivery_contact_image(uuid), public.can_read_delivery_contact_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_delivery_contact_image(text),
  public.get_delivery_contact_image(uuid), public.can_read_delivery_contact_image(text) TO authenticated;

CREATE POLICY "Read assigned delivery contact images" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'delivery-contact-images' AND public.can_read_delivery_contact_image(name));

CREATE POLICY "Upload own delivery contact image" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'delivery-contact-images' AND public.owns_delivery_contact_image(name));

CREATE POLICY "Replace own delivery contact image" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'delivery-contact-images' AND public.owns_delivery_contact_image(name))
WITH CHECK (bucket_id = 'delivery-contact-images' AND public.owns_delivery_contact_image(name));
