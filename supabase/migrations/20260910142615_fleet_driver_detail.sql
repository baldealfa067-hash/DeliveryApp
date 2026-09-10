-- Detalhe de um motorista, para o painel da frota (§12, §32, §39).
--
-- Sem tabela nova: tudo sai de `deliveries`, que ja' esta' ligada a `driver_id`
-- e `fleet_id`, com o bairro vindo de `orders`. §39 -- distinguir dado
-- registado de metrica calculada: aqui nao se guarda nada, conta-se na hora.
--
-- DEVOLVE jsonb e nao RETURNS TABLE porque sao quatro formas diferentes de
-- dados (resumo, bairros, horas, ultimas entregas). Quatro RPCs seriam quatro
-- idas ao servidor e quatro sitios para a autorizacao divergir.
--
-- HORARIOS: por HORA DO DIA, nao por dia da semana. Uma entrega e' uma operacao
-- intra-diaria -- saber a que horas o motorista trabalha diz a' frota quando
-- pode contar com ele, o que e' accionavel; o dia da semana so' comeca a dizer
-- alguma coisa com meses de dados. Junta-se o tempo medio entre aceitar e
-- entregar, e a lista das ultimas entregas com hora exacta, que e' o que
-- realmente ajuda enquanto o volume for pequeno.
--
-- QUILOMETRAGEM FICA DE FORA, de proposito. `distance_km` existe mas §40 diz
-- para nao apresentar valores estimados como se fossem precisos enquanto o GPS
-- nao for fiavel. Mesma decisao ja' tomada em get_fleet_metrics.
--
-- AUTORIZACAO, explicita e em duas partes:
--   1. o motorista tem de existir e ter frota
--   2. quem chama tem de ser DONO dessa frota -- owns_fleet() compara
--      owner_user_id com auth.uid()
-- O proprio motorista e' recusado: nao e' dono de frota nenhuma, e §12 nega-lhe
-- acesso administrativo. Nao ha caminho por onde ele passe. Confirmado por HTTP.
--
-- E' SECURITY DEFINER, e por isso salta o RLS de `deliveries` -- que e'
-- necessario, porque a policy dessa tabela NAO contempla o dono da frota (so'
-- motorista, cliente, dono do restaurante e admin). Pela nota fixada no
-- CLAUDE.md, isso significa que esta funcao verde nao prova nada sobre a
-- leitura directa da tabela: medido, o dono da frota le' 0 linhas de
-- `deliveries`. Sao caminhos diferentes, e e' assim de proposito -- a frota
-- chega aos seus dados pelas RPCs, nao pela tabela.

CREATE OR REPLACE FUNCTION public.get_fleet_driver_detail(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fleet_id uuid;
  v_nome text;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessao';
  END IF;

  SELECT dr.fleet_id, dr.name INTO v_fleet_id, v_nome
  FROM public.drivers dr WHERE dr.id = p_driver_id;

  IF v_fleet_id IS NULL THEN
    RAISE EXCEPTION 'Motorista nao encontrado ou sem frota';
  END IF;

  IF NOT public.owns_fleet(v_fleet_id) THEN
    RAISE EXCEPTION 'Este motorista nao pertence a sua frota';
  END IF;

  SELECT jsonb_build_object(
    'driver_id', p_driver_id,
    'nome', v_nome,

    'resumo', (
      SELECT jsonb_build_object(
        'entregas',    count(*),
        'concluidas',  count(*) FILTER (WHERE d.status = 'entregue'),
        'canceladas',  count(*) FILTER (WHERE d.status = 'cancelado'),
        'em_curso',    count(*) FILTER (WHERE d.status IN ('aceite','recolhido')),
        'ganhos',      COALESCE(sum(d.delivery_fee) FILTER (WHERE d.status = 'entregue'), 0),
        -- Minutos entre aceitar e entregar. NULL quando ainda nao ha' nenhuma
        -- entrega concluida -- nao se devolve 0, que seria afirmar rapidez que
        -- nao se mediu (§84).
        'minutos_medios', (
          SELECT round(avg(extract(epoch FROM (d2.delivered_at - d2.accepted_at)) / 60))
          FROM public.deliveries d2
          WHERE d2.driver_id = p_driver_id
            AND d2.delivered_at IS NOT NULL AND d2.accepted_at IS NOT NULL
        )
      )
      FROM public.deliveries d WHERE d.driver_id = p_driver_id
    ),

    'bairros', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT o.bairro, count(*) AS entregas,
               COALESCE(sum(d.delivery_fee) FILTER (WHERE d.status = 'entregue'), 0) AS ganhos
        FROM public.deliveries d
        JOIN public.orders o ON o.id = d.order_id
        WHERE d.driver_id = p_driver_id AND o.bairro IS NOT NULL
        GROUP BY o.bairro
        ORDER BY count(*) DESC, o.bairro
      ) x
    ), '[]'::jsonb),

    'horas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'hora')::int) FROM (
        SELECT jsonb_build_object(
                 'hora', extract(hour FROM d.delivered_at)::int,
                 'entregas', count(*)
               ) AS x
        FROM public.deliveries d
        WHERE d.driver_id = p_driver_id AND d.delivered_at IS NOT NULL
        GROUP BY extract(hour FROM d.delivered_at)
      ) x
    ), '[]'::jsonb),

    'ultimas', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object(
                 'order_number', o.order_number,
                 'bairro',       o.bairro,
                 'estado',       d.status,
                 'taxa',         d.delivery_fee,
                 'aceite_em',    d.accepted_at,
                 'entregue_em',  d.delivered_at
               ) AS x
        FROM public.deliveries d
        JOIN public.orders o ON o.id = d.order_id
        WHERE d.driver_id = p_driver_id
        ORDER BY d.created_at DESC
        LIMIT 20
      ) x
    ), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

-- Regra de 20260910033308: revogar dos DOIS.
REVOKE EXECUTE ON FUNCTION public.get_fleet_driver_detail(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_fleet_driver_detail(uuid) TO authenticated;
