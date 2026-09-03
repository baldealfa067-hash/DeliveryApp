-- FIX: price_type faltava em novas instalações from-scratch (ex: meafyvhedhhxbjcyzblw)
-- BusinessEdit.tsx:222 envia price_type='combinar', mas schema novo não tinha a coluna
-- Adiciona se não existir (idempotente, não quebra instalações antigas)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS price_type text;
-- Também garantir starting_price existe (já existe, mas idempotente)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS starting_price integer;
