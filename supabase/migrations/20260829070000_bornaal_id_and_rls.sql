-- ============================================================
-- Etapa 9: Segurança RLS + BORNAAL ID
-- ============================================================

-- 1. BORNAAL ID — Formato único: BAAL-XXXX-XXXX
-- Create function to generate BORNAAL ID
CREATE OR REPLACE FUNCTION public.generate_bornaal_id()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id text;
  v_exists boolean := true;
BEGIN
  WHILE v_exists LOOP
    v_id := 'BAAL-' ||
      upper(encode(gen_random_bytes(2), 'hex')) || '-' ||
      upper(encode(gen_random_bytes(2), 'hex'));
    v_id := substring(v_id from 1 for 14); -- BAAL-XXXX-XXXX
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE bornaal_id = v_id) INTO v_exists;
  END LOOP;
  RETURN v_id;
END;
$$;

-- 2. Add bornaal_id to profiles if not exists
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bornaal_id text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3. Create unique index for bornaal_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_bornaal_id ON public.profiles(bornaal_id) WHERE bornaal_id IS NOT NULL;

-- 4. Auto-assign BORNAAL ID on profile creation
CREATE OR REPLACE FUNCTION public.assign_bornaal_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.bornaal_id IS NULL THEN
    NEW.bornaal_id := public.generate_bornaal_id();
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and create new
DROP TRIGGER IF EXISTS trg_assign_bornaal_id ON public.profiles;
CREATE TRIGGER trg_assign_bornaal_id
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_bornaal_id();

-- 5. Add bornaal_id to drivers
DO $$ BEGIN
  ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS bornaal_id text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 6. RPC: Lookup user by BORNAAL ID
CREATE OR REPLACE FUNCTION public.lookup_by_bornaal_id(p_bornaal_id text)
RETURNS TABLE (
  user_id uuid,
  bornaal_id text,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.user_id, p.bornaal_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.bornaal_id = upper(trim(p_bornaal_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_by_bornaal_id(text) TO authenticated;

-- 7. RPC: Search users by BORNAAL ID prefix
CREATE OR REPLACE FUNCTION public.search_bornaal_id(p_prefix text)
RETURNS TABLE (
  user_id uuid,
  bornaal_id text,
  full_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.user_id, p.bornaal_id, p.full_name
  FROM public.profiles p
  WHERE p.bornaal_id ILIKE p_prefix || '%'
  LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_bornaal_id(text) TO authenticated;

-- 8. RPC: Get my BORNAAL ID
CREATE OR REPLACE FUNCTION public.get_my_bornaal_id()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT bornaal_id FROM public.profiles WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_bornaal_id() TO authenticated;

-- 9. Ensure all RLS policies are correctly set

-- Messages: allow sender and receiver
DROP POLICY IF EXISTS "messages_participants_only" ON public.messages;
CREATE POLICY "messages_participants_only"
ON public.messages FOR SELECT
TO authenticated
USING (
  sender_id = auth.uid() OR receiver_id = auth.uid()
);

-- Conversations: allow participants
DROP POLICY IF EXISTS "conversations_participants" ON public.conversations;
CREATE POLICY "conversations_participants"
ON public.conversations FOR SELECT
TO authenticated
USING (
  auth.uid() = ANY(participant_ids)
);

-- Orders: customers see own, business owners see their orders
DROP POLICY IF EXISTS "orders_access" ON public.orders;
CREATE POLICY "orders_access"
ON public.orders FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

-- Appointments: customer and business owner
DROP POLICY IF EXISTS "appointments_access" ON public.appointments;
CREATE POLICY "appointments_access"
ON public.appointments FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

-- Deliveries: driver, restaurant, customer
DROP POLICY IF EXISTS "deliveries_access" ON public.deliveries;
CREATE POLICY "deliveries_access"
ON public.deliveries FOR SELECT
TO authenticated
USING (
  driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  OR order_id IN (
    SELECT id FROM public.orders
    WHERE customer_id = auth.uid()
       OR business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- 10. Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON public.orders(business_id);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON public.appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_business_id ON public.appointments(business_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver_id ON public.deliveries(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order_id ON public.deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_ids ON public.conversations USING GIN(participant_ids);

-- 11. Add bornaal_id to driver registration
CREATE OR REPLACE FUNCTION public.register_as_driver(
  p_name text,
  p_phone text,
  p_vehicle_type text DEFAULT 'moto'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_bornaal_id text;
BEGIN
  -- Get existing BORNAAL ID
  SELECT bornaal_id INTO v_bornaal_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_bornaal_id IS NULL THEN
    v_bornaal_id := public.generate_bornaal_id();
    UPDATE public.profiles SET bornaal_id = v_bornaal_id WHERE user_id = auth.uid();
  END IF;

  INSERT INTO public.drivers (user_id, name, phone, vehicle_type, bornaal_id)
  VALUES (auth.uid(), p_name, p_phone, p_vehicle_type, v_bornaal_id)
  ON CONFLICT (user_id) DO UPDATE
    SET name = p_name, phone = p_phone, vehicle_type = p_vehicle_type, bornaal_id = v_bornaal_id
  RETURNING id INTO v_driver_id;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_as_driver(text, text, text) TO authenticated;
