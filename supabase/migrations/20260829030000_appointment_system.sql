-- ============================================================
-- Etapa 5: Agendamento de Salões de Beleza
-- ============================================================

-- 1. Tabela de agendamentos
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  service_name text NOT NULL,
  service_price numeric(12,2),
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  status text DEFAULT 'solicitado' NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Constraints
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('solicitado', 'confirmado', 'em_atendimento', 'concluido', 'avaliado', 'cancelado'));

-- 2. Tabela de histórico de agendamentos
CREATE TABLE IF NOT EXISTS public.appointment_status_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.appointment_status_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for appointment_status_history
CREATE POLICY "Appointment history viewable by involved"
ON public.appointment_status_history FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = appointment_id
    AND (
      a.customer_id = auth.uid()
      OR a.business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  )
);

GRANT SELECT ON public.appointment_status_history TO authenticated;
GRANT ALL ON public.appointment_status_history TO service_role;

-- 3. RLS for appointments
CREATE POLICY "Appointments viewable by involved"
ON public.appointments FOR SELECT
TO public
USING (
  customer_id = auth.uid()
  OR business_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

GRANT SELECT ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;

-- 4. RPC: Criar agendamento
CREATE OR REPLACE FUNCTION public.create_appointment(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_service_name text,
  p_service_price numeric,
  p_appointment_date date,
  p_appointment_time time,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_appointment_id uuid;
  v_owner uuid;
BEGIN
  IF p_business_id IS NULL THEN RAISE EXCEPTION 'Salão em falta'; END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  IF p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN RAISE EXCEPTION 'Telefone obrigatório'; END IF;
  IF p_appointment_date IS NULL OR p_appointment_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Data inválida';
  END IF;
  IF p_appointment_time IS NULL THEN RAISE EXCEPTION 'Hora obrigatória'; END IF;

  INSERT INTO public.appointments (
    business_id, customer_id, customer_name, customer_phone,
    service_name, service_price, appointment_date, appointment_time,
    status, notes
  ) VALUES (
    p_business_id,
    CASE WHEN p_customer_id IS NOT NULL THEN p_customer_id ELSE NULL END,
    p_customer_name, p_customer_phone,
    p_service_name, p_service_price, p_appointment_date, p_appointment_time,
    'solicitado', NULLIF(btrim(p_notes), '')
  ) RETURNING id INTO v_appointment_id;

  -- History
  INSERT INTO public.appointment_status_history (appointment_id, status, created_by)
  VALUES (v_appointment_id, 'solicitado', auth.uid());

  -- Notification to salon owner
  SELECT user_id INTO v_owner FROM public.profiles WHERE id = p_business_id;
  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_owner, 'novo_agendamento', 'Novo agendamento',
            p_service_name || ' · ' || p_customer_name || ' · ' || p_appointment_date::text,
            '/painel-beleza');
  END IF;

  RETURN v_appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_appointment(uuid, uuid, text, text, text, numeric, date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_appointment(uuid, uuid, text, text, text, numeric, date, time, text) TO authenticated;

-- 5. RPC: Atualizar estado do agendamento
CREATE OR REPLACE FUNCTION public.update_appointment_status(
  p_appointment_id uuid,
  p_new_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_service_name text;
  v_status_label text;
BEGIN
  IF p_new_status NOT IN ('solicitado', 'confirmado', 'em_atendimento', 'concluido', 'avaliado', 'cancelado') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.appointments
  SET status = p_new_status, updated_at = now()
  WHERE id = p_appointment_id
  RETURNING customer_id, service_name INTO v_customer_id, v_service_name;

  INSERT INTO public.appointment_status_history (appointment_id, status, note, created_by)
  VALUES (p_appointment_id, p_new_status, p_note, auth.uid());

  CASE p_new_status
    WHEN 'confirmado' THEN v_status_label := '✅ O seu agendamento foi confirmado.';
    WHEN 'em_atendimento' THEN v_status_label := '💇 O serviço está a ser realizado.';
    WHEN 'concluido' THEN v_status_label := '✅ Serviço concluído. Obrigado!';
    WHEN 'cancelado' THEN v_status_label := '❌ Agendamento cancelado.';
    ELSE v_status_label := 'Agendamento atualizado: ' || p_new_status;
  END CASE;

  IF v_customer_id IS NOT NULL AND v_customer_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_customer_id, 'appointment_update', 'Atualização do agendamento', v_status_label, '/meus-agendamentos');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_appointment_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_appointment_status(uuid, text, text) TO authenticated;

-- 6. RPC: Obter agendamentos de um salão
CREATE OR REPLACE FUNCTION public.get_business_appointments(
  p_business_id uuid,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  customer_name text,
  customer_phone text,
  service_name text,
  service_price numeric,
  appointment_date date,
  appointment_time time,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.customer_name, a.customer_phone,
         a.service_name, a.service_price,
         a.appointment_date, a.appointment_time,
         a.status, a.notes, a.created_at, a.updated_at
  FROM public.appointments a
  WHERE a.business_id = p_business_id
    AND (p_status IS NULL OR a.status = p_status)
  ORDER BY a.appointment_date DESC, a.appointment_time DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_appointments(uuid, text) TO authenticated;

-- 7. RPC: Obter agendamentos de um cliente
CREATE OR REPLACE FUNCTION public.get_customer_appointments(
  p_customer_id uuid
)
RETURNS TABLE (
  id uuid,
  business_id uuid,
  business_name text,
  service_name text,
  service_price numeric,
  appointment_date date,
  appointment_time time,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.business_id, p.name as business_name,
         a.service_name, a.service_price,
         a.appointment_date, a.appointment_time,
         a.status, a.notes, a.created_at, a.updated_at
  FROM public.appointments a
  JOIN public.profiles p ON p.id = a.business_id
  WHERE a.customer_id = p_customer_id
  ORDER BY a.appointment_date DESC, a.appointment_time DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_appointments(uuid) TO authenticated;

-- 8. Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_status_history; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
