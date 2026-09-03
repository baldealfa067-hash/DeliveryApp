-- Adiciona a tabela provider_stats à publicação realtime para as
-- estatísticas (vistas/WhatsApp/ligações) atualizarem em tempo real.
ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_stats;