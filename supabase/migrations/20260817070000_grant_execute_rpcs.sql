-- Garantir que visitantes (anon) e utilizadores autenticados
-- conseguem chamar os RPCs de registo de activity

GRANT EXECUTE ON FUNCTION public.increment_provider_view(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_contact(uuid, text) TO anon, authenticated;
