-- Tempo médio de preparação, declarado pelo restaurante.
--
-- Opcional de propósito: o cartão da lista só mostra este valor se o
-- restaurante o tiver preenchido. Nunca há valor por defeito nem estimativa
-- inventada — um número errado sobre quanto tempo falta para a comida chegar
-- custa mais confiança do que a ausência do número.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS prep_time_minutes integer;

-- Limites de sanidade: nem 0 minutos, nem um valor absurdo por engano no teclado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_prep_time_minutes_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_prep_time_minutes_range
      CHECK (prep_time_minutes IS NULL OR (prep_time_minutes BETWEEN 1 AND 480));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.prep_time_minutes IS
  'Tempo médio de preparação em minutos, declarado pelo restaurante. NULL = não declarado, não mostrar.';
