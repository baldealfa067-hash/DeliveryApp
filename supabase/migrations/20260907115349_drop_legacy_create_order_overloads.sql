-- Existiam quatro funcoes com o nome create_order, a diferirem apenas no numero
-- de argumentos (9, 10, 12 e 15). Cada funcionalidade nova — bairro, GPS, nota
-- de voz, pagamento — criou uma versao nova em vez de substituir a anterior.
--
-- Qual delas corre depende de quantos campos o cliente enviar. Uma app antiga
-- em cache (a PWA fica guardada no telemovel ate a pessoa recarregar) enviava 12
-- campos, caia na versao de 12 e criava o pedido sem metodo de pagamento nem
-- nota de voz — em silencio, sem erro nenhum.
--
-- Apagadas as tres antigas. Quem tiver a app desactualizada passa a receber um
-- erro visivel em vez de gravar um pedido pela metade; basta recarregar.
--
-- Confirmado antes de apagar: nenhuma outra funcao da base e nenhuma edge
-- function chamam create_order; o frontend actual envia sempre os 15 campos.
DROP FUNCTION IF EXISTS public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_order(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, double precision, double precision);
