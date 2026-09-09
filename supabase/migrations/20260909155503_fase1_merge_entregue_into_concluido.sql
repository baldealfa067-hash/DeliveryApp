-- FASE 1 -- `entregue` e `concluido` eram dois estados terminais em uso
-- simultaneo em orders.status (11 concluido + 4 entregue em producao).
-- Decisao do dono do projecto (2026-09-09): sao o mesmo estado, `entregue` e'
-- lixo herdado. Nao colide com o Aditamento 2: nao e' renomear nomenclatura
-- viva, e' remover um estado morto duplicado.
--
-- AMBITO DELIBERADO DESTA MIGRACAO:
--
-- 1. orders.status  -> funde. E' o estado vivo do pedido.
--
-- 2. order_status_history  -> NAO se toca. Sao 22 linhas que registam o que o
--    sistema fez de facto, no momento em que o fez. Reescreve-las faria o
--    rasto de auditoria mentir sobre o passado, contra §56 e §74. A historia
--    fica como aconteceu; o estado vivo e' que passa a ser unico.
--
-- 3. deliveries.status -> NAO se toca. E' outro dominio de valores
--    (pendente / aceite / recolhido / entregue / cancelado) onde `entregue` e'
--    o unico estado terminal de sucesso e nao existe `concluido`. Nao ha
--    duplicacao nenhuma para fundir ai'.
UPDATE public.orders
SET status = 'concluido', updated_at = now()
WHERE status = 'entregue';
