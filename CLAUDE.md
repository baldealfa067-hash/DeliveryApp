## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

# Documento mestre — POR PREENCHER

> **ATENÇÃO:** o documento mestre (visão, regras de negócio, arquitetura,
> roadmap de 10 fases) e os dois aditamentos ainda NÃO estão gravados. Até
> 2026-09-09 existiram apenas dentro de uma sessão de conversa, que perdeu o
> contexto. Nenhuma cópia foi encontrada em disco.
>
> Enquanto esta secção estiver vazia, nenhuma fase depois da Fase 1 pode ser
> planeada, porque a ordem das fases vive nesse documento.

## Aditamentos (conhecidos por referência, texto original em falta)
1. Motorista individual só entra via frota — não há registo de motorista avulso.
2. Farmácias entram como categoria, reaproveitando a infraestrutura de
   restaurantes que já existe.
3. Não renomear estados do fluxo de pedido.

---

# Decisões confirmadas pelo dono do projeto

## 2026-09-09
- **`entregue` e `concluido` são o mesmo estado.** `entregue` é lixo herdado.
  Fundir os dois em `concluido` por migração. Não colide com o Aditamento 2:
  não é renomear nomenclatura viva, é remover um estado morto duplicado. Os
  restantes nomes de estado continuam intocáveis.
- **`profiles.phone` fica público de propósito.** É informação de contacto
  normal, como já era no Bornaal. Esta coluna NÃO entra na correção de RLS.
- **As restantes falhas de RLS seguem a ordem do roadmap**, não são corrigidas
  isoladamente fora de fase.

---

# Fase 1 — âmbito aprovado (2026-09-09)

Aprovada pelo dono do projeto. Não avançar para a Fase 2 sem aprovação
explícita do checklist da Fase 1.

- [ ] Autorização em `update_order_status` — hoje qualquer autenticado pode
      mudar o estado de qualquer pedido (SECURITY DEFINER sem verificação de
      dono; o único `auth.uid()` do corpo serve para `created_by`)
- [ ] Acrescentar `driver` ao enum `app_role` (hoje: client, provider, admin,
      business, beleza)
- [ ] RLS de `drivers` — hoje `USING (true)` para o papel público, com GRANT de
      SELECT em `phone`, `current_lat`, `current_lng`
- [ ] REVOKE dos RPCs `SECURITY DEFINER` ao `anon` (48 funções)
- [ ] Fechar `profiles` a anónimos, EXCETO `phone` que fica público
- [ ] Fechar `messages` a anónimos (hoje anon insere para qualquer
      `receiver_id`, e qualquer pessoa lê mensagens com `sender_id IS NULL`)
- [ ] Remover as policies duplicadas em `profiles` (2) e `notifications` (4 pares)
- [ ] Fundir `entregue` em `concluido`
- [ ] Apagar as 4 contas de motorista de teste (Test2, alfa, Motorista D,
      Alfa Balde) — confirmado como dados de teste

## Adiado, não bloqueia a Fase 1
- Rotação da chave anon JWT (planear por causa dos triggers de push)
- Remoção do código órfão (~2900 linhas) e das 11 tabelas vazias — fase de
  limpeza do Bornaal
- Refactor de AdminDashboard.tsx (1464 linhas) e BusinessDetail.tsx (1143)
- Kriol a 63% (748/1182 chaves)
