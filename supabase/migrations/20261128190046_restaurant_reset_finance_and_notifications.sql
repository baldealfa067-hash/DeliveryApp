-- The operating reset remains owner-accessible. Only a privileged operator can
-- set a financial cutover after identifying the restaurant's test records.
ALTER TABLE public.restaurant_operation_start ADD COLUMN finance_started_at timestamptz;

CREATE FUNCTION public.get_restaurant_finance_start(p_business_id uuid)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (
    public.has_restaurant_permission(p_business_id, 'finance')
    OR public.has_restaurant_permission(p_business_id, 'commission')
    OR coalesce(public.has_role(auth.uid(), 'admin'), false)
  ) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT finance_started_at FROM public.restaurant_operation_start WHERE business_id = p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurant_finance_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_finance_start(uuid) TO authenticated;

DO $$
DECLARE
  edit record;
  definition text;
  updated_definition text;
  ledger_date constant text := 'coalesce(
    (SELECT o.created_at FROM public.orders o WHERE o.id = %1$s.order_id),
    (SELECT cp.created_at FROM public.commission_payments cp WHERE cp.id = %1$s.payment_id),
    (SELECT s.declared_at FROM public.cash_settlements s WHERE s.id = %1$s.settlement_id),
    %1$s.created_at)';
  finance_start constant text := 'coalesce((SELECT x.finance_started_at
    FROM public.restaurant_operation_start x WHERE x.business_id = %s), ''-infinity''::timestamptz)';
BEGIN
  FOR edit IN SELECT * FROM (VALUES
    ('notify_order_status_change()', 'IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;',
      'PERFORM 1 FROM auth.users WHERE id = NEW.customer_id FOR KEY SHARE;
       IF NOT FOUND THEN RETURN NEW; END IF;'),
    ('get_business_commission_internal(uuid)', 'WHERE e.business_id = p_business_id',
      'WHERE e.business_id = p_business_id AND ' || format(ledger_date, 'e') || ' >= ' || format(finance_start, 'p_business_id')),
    ('get_all_commissions()', 'WHERE v.account_kind=''business''',
      'WHERE v.account_kind=''business'' AND ' || format(ledger_date, 'v') || ' >= ' || format(finance_start, 'v.business_id')),
    ('get_business_cash_settlements(uuid)', 'WHERE e.account_kind = ''business'' AND e.business_id = p_business_id',
      'WHERE e.account_kind = ''business'' AND e.business_id = p_business_id AND ' ||
        format(ledger_date, 'e') || ' >= ' || format(finance_start, 'p_business_id')),
    ('get_business_cash_settlements(uuid)', 'FROM public.cash_settlements s WHERE s.business_id = p_business_id',
      'FROM public.cash_settlements s WHERE s.business_id = p_business_id AND s.declared_at >= ' ||
        format(finance_start, 'p_business_id'))
  ) AS edits(signature, anchor, replacement)
  LOOP
    definition := pg_get_functiondef(('public.' || edit.signature)::regprocedure);
    updated_definition := replace(definition, edit.anchor, edit.replacement);
    IF updated_definition = definition THEN
      RAISE EXCEPTION 'Cláusula não encontrada em %', edit.signature;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END;
$$;
