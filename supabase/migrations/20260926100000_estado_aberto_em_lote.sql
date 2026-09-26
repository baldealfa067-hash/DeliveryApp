-- "Aberto / Fechado" nos cartões da lista de restaurantes (2026-09-26).
--
-- Até aqui só a página de cada restaurante sabia se ele estava aberto
-- (get_business_hours). Na lista, o cliente tinha de entrar em cada um para
-- saber. Pedir get_business_hours por cartão era uma chamada por restaurante
-- (§50: baixo consumo de dados); esta responde a todos de uma vez.
--
-- A regra é a MESMA — chama is_business_open, que já decide o interruptor
-- manual, o horário, os períodos que atravessam a meia-noite e o "sem horário =
-- sempre aberto" (Fase 2.5). Não há segunda cópia da regra para divergir.
--
-- Pública, como get_business_hours e is_business_open: é a montra, e o cliente
-- vê-a antes de ter conta. Não expõe nada que essas duas não exponham já.

CREATE OR REPLACE FUNCTION public.get_businesses_open(p_ids uuid[])
RETURNS TABLE (business_id uuid, aberto_agora boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Teto: a lista tem uma página de restaurantes, não a base inteira.
  IF coalesce(array_length(p_ids, 1), 0) > 200 THEN
    RAISE EXCEPTION 'No maximo 200 restaurantes de cada vez';
  END IF;

  RETURN QUERY
  SELECT i.id, public.is_business_open(i.id)
  FROM (SELECT DISTINCT unnest(p_ids) AS id) i;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_businesses_open(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_businesses_open(uuid[]) TO anon, authenticated;
