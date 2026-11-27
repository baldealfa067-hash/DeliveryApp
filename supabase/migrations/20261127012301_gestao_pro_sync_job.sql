-- The pilot uses the existing database scheduler. Connection secrets stay in Vault.
CREATE TABLE public.gestao_pro_sync_cursor (
  connection_id uuid PRIMARY KEY REFERENCES public.order_sync_connections(id) ON DELETE CASCADE,
  after_at timestamptz,
  after_id uuid
);
ALTER TABLE public.gestao_pro_sync_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gestao_pro_sync_cursor FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.gestao_pro_sync_http(p_method text, p_url text,
  p_headers extensions.http_header[], p_body jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r extensions.http_response;
BEGIN
  PERFORM set_config('http.curlopt_timeout_ms', '3000', true);
  r := extensions.http((p_method, p_url, p_headers,
    'application/json', p_body::text)::extensions.http_request);
  IF r.status NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'Sincronização Gestão Pro: HTTP %', r.status;
  END IF;
  RETURN coalesce(nullif(r.content, '')::jsonb, 'null'::jsonb);
END;
$$;

CREATE FUNCTION public.sync_gestao_pro_pilot()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  cfg jsonb;
  source_headers extensions.http_header[];
  destination_headers extensions.http_header[];
  source_url constant text := 'https://www.itudoo.com/api/partner-orders';
  destination_url constant text := 'https://qiwmwlxryzyhmouvnjkh.supabase.co/rest/v1/rpc/';
  action jsonb;
  snapshot jsonb;
  snapshots jsonb;
  current_cursor public.gestao_pro_sync_cursor%ROWTYPE;
  page_url text;
  count_synced integer := 0;
  had_action_error boolean := false;
BEGIN
  IF NOT pg_try_advisory_xact_lock(4922102761) THEN RETURN 0; END IF;
  SELECT decrypted_secret::jsonb INTO cfg FROM vault.decrypted_secrets WHERE name = 'gestao_pro_ak_house';
  IF cfg IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.gestao_pro_sync_cursor(connection_id) VALUES ((cfg->>'connection_id')::uuid)
    ON CONFLICT DO NOTHING;
  SELECT * INTO current_cursor FROM public.gestao_pro_sync_cursor
    WHERE connection_id = (cfg->>'connection_id')::uuid;
  source_headers := ARRAY[ROW('Authorization','Bearer ' || (cfg->>'source_token'))::extensions.http_header];
  destination_headers := ARRAY[ROW('apikey',cfg->>'destination_key')::extensions.http_header];

  FOR action IN SELECT value FROM jsonb_array_elements(public.gestao_pro_sync_http(
    'POST', destination_url || 'get_external_order_actions', destination_headers,
    jsonb_build_object('p_token', cfg->>'destination_token')))
  LOOP
    BEGIN
      PERFORM public.gestao_pro_sync_http('POST', source_url, source_headers,
        jsonb_build_object('order_id', action->>'external_id', 'action', action->>'requested_status'));
    EXCEPTION WHEN OTHERS THEN
      had_action_error := true;
    END;
  END LOOP;

  -- Replay a small overlap to account for out-of-order commits. Page using the full cursor.
  IF current_cursor.after_at IS NOT NULL THEN
    current_cursor.after_at := current_cursor.after_at - interval '2 minutes';
    current_cursor.after_id := '00000000-0000-0000-0000-000000000000';
  END IF;
  LOOP
    page_url := source_url;
    IF current_cursor.after_at IS NOT NULL THEN
      page_url := page_url || '?after=' || to_char(current_cursor.after_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '&after_id=' || current_cursor.after_id::text;
    END IF;
    snapshots := public.gestao_pro_sync_http('GET', page_url, source_headers) -> 'orders';
    IF jsonb_typeof(snapshots) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Resposta inválida da API de parceiros';
    END IF;
    FOR snapshot IN SELECT value FROM jsonb_array_elements(snapshots)
    LOOP
      PERFORM public.gestao_pro_sync_http('POST', destination_url || 'sync_external_order', destination_headers,
        jsonb_build_object('p_token', cfg->>'destination_token', 'p_order', snapshot->'payload'));
      current_cursor.after_at := (snapshot->>'updated_at')::timestamptz;
      current_cursor.after_id := (snapshot->>'id')::uuid;
      count_synced := count_synced + 1;
    END LOOP;
    EXIT WHEN jsonb_array_length(snapshots) < 100;
  END LOOP;

  IF had_action_error THEN RAISE WARNING 'Gestão Pro: há ações pendentes para repetir.'; END IF;
  IF count_synced > 0 THEN
    UPDATE public.gestao_pro_sync_cursor SET after_at = current_cursor.after_at, after_id = current_cursor.after_id
      WHERE connection_id = current_cursor.connection_id
        AND (after_at IS NULL OR (after_at, after_id) < (current_cursor.after_at, current_cursor.after_id));
  END IF;
  RETURN count_synced;
END;
$$;

REVOKE ALL ON FUNCTION public.gestao_pro_sync_http(text,text,extensions.http_header[],jsonb),
  public.sync_gestao_pro_pilot() FROM PUBLIC, anon, authenticated;
