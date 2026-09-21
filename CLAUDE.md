## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

# ADITAMENTO 1 — Decisão sobre motoristas individuais (ler antes do documento principal)

O documento principal abaixo (secção 11) estabelece que na V1 só frotas podem se registar como operadores logísticos — sem cadastro aberto de motorista individual.

**Decisão confirmada pelo dono do projeto: seguir esta regra à risca.** Já existe uma parceria real com frotas que vão querer registar-se — a operação inicial deve passar por elas, não por motoristas avulsos sem supervisão.

Isto entra em conflito direto com trabalho já existente no repositório: o registo independente de motorista individual (cartão "Motorista" no ecrã de login, autenticação telefone+PIN) já foi construído, testado e publicado em produção, com contas de teste reais já criadas.

## O que fazer com isto, especificamente

1. **Na Fase 0 (auditoria)**, mapeia exatamente o que existe do registo de motorista individual: o cartão de login, a rota de registo, as contas de teste já criadas em `drivers` sem `fleet_id`, e qualquer RPC/lógica que dependa disto.

2. **Não apagues as contas de teste que já existem** só por causa desta mudança — são dados reais de teste, e a instrução geral do documento é não apagar dados sem verificar a utilização primeiro. Relata o que encontraste e como propões tratá-las (ex: ficam como estão, associadas a `fleet_id = null`, tratadas como "legado" até decidirmos se migram para dentro de uma frota ou se ficam congeladas).

3. **Remove/esconde da interface** o cartão "Motorista" como opção de registo independente no ecrã de login — o registo de operação logística passa a ser exclusivamente via Frota.

4. **Não apagues o código do fluxo do motorista em si** (`DriverDashboard`, aceitar/recolher/entregar, etc.) — esse continua necessário, é só acedido a partir de agora através de uma conta criada por uma frota, não por auto-registo. Confirma que a arquitetura de frota reutiliza este código, em vez de o duplicar.

5. Sinaliza no teu relatório de auditoria, de forma explícita, esta reversão — para ficar documentado que foi uma decisão deliberada e não um esquecimento.

---

# ADITAMENTO 2 — Farmácias e nomenclatura de estados (ler junto com o Aditamento 1)

## Farmácias (secção 20 do documento principal)
Confirmado pelo dono do projeto: Farmácias entra como **categoria dentro da plataforma**, ao estilo Glovo — reaproveita a mesma infraestrutura já existente de restaurante/menu/carrinho/checkout. Não é um sistema separado nem uma vertical com arquitetura própria — é uma categoria a mais dentro do modelo `business`/`profiles` que já existe, com as mesmas tabelas de menu/produtos reutilizadas. Trata isto como uma extensão do que já existe, não uma reconstrução.

## Nomenclatura de estados de pedido (secção 36 do documento principal)
Confirmado pelo dono do projeto: **NÃO renomear os estados do pedido**. O documento principal sugere nomes em inglês (PENDING, ACCEPTED, PREPARING, READY, DRIVER_ASSIGNED, DRIVER_ACCEPTED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED) — ignora essa sugestão de nomenclatura.

Mantém exatamente os nomes que já existem e estão testados no sistema atual (novo, confirmado, em_preparacao, pronto, aguardando_motorista, motorista_encontrado, pedido_recolhido, a_caminho, entregue, concluido, cancelado). O que importa da secção 36 é a **disciplina** (nunca permitir saltos arbitrários de estado pelo frontend, estado sempre validado no backend) — essa parte já está implementada e testada por um teste E2E automatizado; não mexer nos nomes das constantes, só confirmar que a disciplina de validação está robusta.

---

# REGRA DE ENGENHARIA — como se testa RLS e isolamento (permanente)

**Testes de RLS e de isolamento têm de usar HTTP real com JWT de utilizador
normal. Nunca `service_role`, nunca MCP privilegiado, nunca `psql` como dono da
base de dados.**

`service_role` **ignora RLS por completo**. Um teste que passa sob `service_role`
não prova absolutamente nada sobre o que um utilizador real consegue — ou não
consegue — fazer. Prova apenas que o SQL é sintaticamente válido.

Isto já causou pelo menos uma avaria real em produção: a Fase 3 introduziu
**recursão infinita** entre as policies de `fleets` e `drivers` (cada uma lia a
tabela da outra). Qualquer leitura directa de `fleets` por um utilizador
autenticado devolvia `42P17 infinite recursion detected in policy`, ou seja,
HTTP 500 — o destino pós-login e o separador de preços do painel ficaram
partidos. O teste de ponta a ponta dessa fase tinha **sete assertivas verdes**,
todas corridas por MCP com `service_role`, sobre código que nenhum utilizador
real conseguia executar. Só apareceu quando se fez um pedido HTTP autenticado.

## Como testar, então

1. Criar contas de teste pela API pública (`/auth/v1/signup`) com a chave
   **anon**, que é a que o frontend usa.
2. Guardar o `access_token` devolvido e usá-lo como `Authorization: Bearer` em
   todos os pedidos seguintes, com `apikey: <anon>`.
3. Exercitar os caminhos reais: `/rest/v1/<tabela>` para leituras directas
   (é aí que o RLS se aplica) e `/rest/v1/rpc/<nome>` para as RPCs.
4. Para isolamento, criar **duas** contas e confirmar que a segunda vê zero —
   tanto pelas RPCs como pela **tabela directamente**, que são caminhos
   diferentes e falham de maneiras diferentes.
5. Limpar os dados de teste no fim, com salvaguarda que aborta se tocarem em
   dados reais.

## Nota sobre RPCs `SECURITY DEFINER`

Uma RPC `SECURITY DEFINER` também salta o RLS da tabela que consulta. Isso é
útil — é assim que se quebram ciclos de policies — mas significa que **uma RPC
verde não confirma que a leitura directa da mesma tabela funciona**. Foi por
isso que a recursão passou despercebida: as RPCs da frota funcionavam, e a
tabela não. Testar sempre os dois caminhos.

O caso vivo disto é `deliveries`: as RPCs da frota devolvem os dados todos, e a
leitura directa da tabela com o mesmo JWT devolve **zero linhas** — porque a
policy não contempla o dono da frota. É deliberado (ver decisões de
2026-09-10), mas serve de aviso: os dois caminhos podem discordar em silêncio, e
só se descobre medindo os dois.

---

# DOCUMENTO MESTRE — DELIVERYAPP
## Documento Mestre de Visão, Produto, Regras de Negócio e Engenharia
Versão: Setembro de 2026
Status: Documento oficial de orientação para desenvolvimento
Objetivo: Servir como contexto principal para o Claude Code antes da reconstrução/evolução da plataforma.


## 1. INSTRUÇÃO PRINCIPAL PARA O CLAUDE CODE

Leia este documento inteiro antes de alterar qualquer código.

O objetivo não é simplesmente corrigir bugs ou adicionar algumas funcionalidades ao projeto existente. O objetivo é transformar o projeto atual em uma plataforma de delivery, logística e mobilidade adaptada à realidade da Guiné-Bissau, começando por Bissau.

Antes de implementar qualquer mudança estrutural:
1. Audite completamente o repositório.
2. Entenda a arquitetura atual.
3. Analise o banco de dados.
4. Analise autenticação.
5. Analise RLS e segurança.
6. Analise storage.
7. Analise notificações.
8. Analise todas as rotas.
9. Analise todos os componentes.
10. Identifique funcionalidades existentes que podem ser reaproveitadas.
11. Identifique código morto.
12. Identifique referências ao projeto Bornaal.
13. Identifique possíveis dados/configurações contaminados do Bornaal.
14. Identifique inconsistências entre o código atual e esta visão.
15. Produza primeiro uma auditoria técnica.
16. Depois produza um plano de reconstrução por fases.
17. Não faça uma grande alteração estrutural sem compreender o impacto.
18. Preserve dados reais existentes quando forem legítimos e necessários.
19. Nunca apagar dados simplesmente porque parecem antigos sem verificar a sua utilização.
20. Testar cada módulo depois da implementação.

Não invente requisitos que contradigam este documento. Quando houver uma decisão ainda não especificada, sinalize a questão antes de implementar uma solução estrutural.

## 2. VISÃO DO PRODUTO

O DeliveryApp será uma plataforma digital de entrega e mobilidade para a Guiné-Bissau. A primeira operação será em Bissau.

A inspiração vem de plataformas como Glovo, Uber Eats, Yango e outras plataformas de delivery e mobilidade — mas o DeliveryApp não deve ser uma cópia dessas plataformas. Deve ser construído para as condições reais do mercado guineense.

A visão de longo prazo é: permitir que uma pessoa entre na plataforma e consiga pedir, enviar ou transportar praticamente qualquer coisa através de uma rede logística local. A V1 começa simples. Depois evolui.

## 3. O CONCEITO CENTRAL

O produto deve funcionar em torno de uma ideia: o cliente diz o que precisa e a plataforma encontra a operação necessária para executar o serviço.

Exemplo: Cliente → "Quero comida" → Restaurante → Frota → Motorista → Cliente
Ou: Cliente → "Quero enviar um documento para Safim" → Frota → Motorista → Safim
Ou futuramente: Cliente → "Quero ir para Bandim" → Transporte → Motorista → Cliente

A plataforma deve ser construída para suportar diferentes tipos de serviços usando uma infraestrutura comum.

## 4. CATEGORIAS DA PLATAFORMA — V1

O lançamento inicial terá foco em:
- 🍔 Restaurantes — cliente escolhe restaurante, comida e solicita entrega.
- 📦 Entregas — cliente pode solicitar entrega de documentos, pequenos objetos, outros itens permitidos.
- 💊 Farmácias — cliente pode visualizar farmácias, produtos disponíveis e solicitar entrega.

## 5. CATEGORIAS FUTURAS

A arquitetura deve permitir adicionar posteriormente:
- 🏍️ Mototáxi — cliente solicita transporte em moto.
- 🚕 Táxi — cliente solicita transporte de passageiros.
- 🛒 Lojas — cliente compra produtos de lojas.
- 🛍️ Supermercados — cliente compra produtos de supermercados.
- 📦 "Enviar qualquer coisa" — uma vertical logística mais ampla.
- Motoristas individuais — no futuro, uma pessoa que possui uma moto poderá se registrar diretamente na plataforma sem pertencer a uma frota.

## 6. PRINCÍPIO DE DESENVOLVIMENTO

A arquitetura deve ser preparada para o futuro, mas a V1 não deve ser excessivamente complexa. Não construir funcionalidades complexas apenas porque poderão ser necessárias no futuro. A regra é: preparar a arquitetura para evoluir, mas implementar somente o necessário para validar a operação atual.

## 7. OS PAPÉIS DA PLATAFORMA

Existem quatro papéis principais: Cliente, Restaurante, Frota/Motorista, Administrador. O motorista pertence a uma frota na V1.

## 8. CLIENTE

O cliente pode: criar conta; navegar; pesquisar; visualizar restaurantes; visualizar farmácias; visualizar produtos; fazer pedidos; solicitar entregas; acompanhar pedidos; gravar mensagens de voz; fornecer localização; escolher pagamento; consultar histórico; avaliar serviços quando essa funcionalidade estiver implementada.

**Autenticação:** A conta de cliente deve utilizar Telefone + PIN de 4 dígitos. Não exigir email. Não depender de SMS pago para o fluxo normal. Qualquer alteração futura no mecanismo de autenticação deve ser tratada como uma migração cuidadosamente planejada.

## 9. NAVEGAÇÃO PÚBLICA

Uma decisão fundamental: ter uma conta de negócio não impede a pessoa de utilizar a plataforma como cliente. Por exemplo: dono de restaurante pode pedir comida; dono de frota pode pedir comida; motorista pode navegar e fazer pedidos.

Portanto: CONTA ≠ RESTRIÇÃO À NAVEGAÇÃO. O que muda de acordo com o papel é a capacidade de gerenciar recursos privados.

## 10. GESTÃO PRIVADA

Cada conta somente pode administrar os seus próprios recursos.
- Restaurante: seu restaurante, seus produtos, seus pedidos e suas finanças.
- Frota: sua frota, seus motoristas, suas entregas e suas finanças.
- Motorista: sua própria operação de motorista.
- Admin: a plataforma.

## 11. FROTAS — MODELO V1

Esta é uma decisão estrutural. Na V1 somente FROTAS podem se registrar como operadores logísticos. Não haverá cadastro aberto de motoristas individuais na primeira versão operacional.

Uma frota pode ser: uma empresa; uma pessoa que possui várias motos; um grupo de motoristas; uma operação logística.

Depois do registro, a frota cadastra os seus próprios motoristas: Registra motoristas → Gerencia motoristas → Define preços → Recebe pedidos → Distribui pedidos → Acompanha operação.

## 12. MOTORISTAS NA V1

O motorista continua tendo uma conta própria para utilizar a aplicação no telefone. Porém: o motorista pertence a uma frota. A frota é responsável por registrar e gerenciar os seus motoristas.

A frota deve conseguir: adicionar motorista; ativar motorista; desativar motorista; visualizar motorista; acompanhar entregas; consultar desempenho; consultar ganhos/métricas; acompanhar atividade.

O motorista não deve ter acesso administrativo à frota.

## 13. PREÇOS DE ENTREGA — V1

Esta decisão está fechada. A frota define os preços. Os preços são cadastrados previamente na plataforma. O modelo inicial será: preço por bairro/zona.

Exemplo: Sabi → 1.000 FCFA; França → 1.500 FCFA; Ntula → 2.000 FCFA; Bairro Militar → 1.500 FCFA; Safim → 2.500 FCFA.

A frota pode definir o preço aplicável a cada bairro/zona.

## 14. COMPORTAMENTO DO SISTEMA DE PREÇOS

A frota não precisa negociar manualmente com o cliente em cada pedido. Ela cadastra os preços previamente. Depois: Cliente informa destino → Sistema identifica bairro/zona → Sistema consulta preço da frota → Preço é apresentado ao cliente → Cliente aceita → Pedido é confirmado.

O cliente deve sempre saber o preço da entrega antes de confirmar.

## 15. IMPORTANTE — PREÇO POR BAIRRO

Na V1, o sistema não precisa obrigatoriamente calcular a distância em quilômetros para determinar o preço. A lógica é baseada no bairro/zona. Isso é deliberado porque a infraestrutura de endereços de Bissau não é suficientemente padronizada para depender exclusivamente de mapas e endereços formais.

## 16. EVOLUÇÃO FUTURA DO PREÇO

No futuro, a plataforma poderá permitir que qualquer pessoa com uma moto se registre diretamente como motorista. Nesse momento, o sistema poderá evoluir para: Origem → Destino → GPS → Distância → Preço por KM → Preço final.

Também poderá existir: Preço base + KM + zona + horário + demanda + tipo de veículo. Mas isso é FUTURO. Não implementar como requisito da V1.

## 17. RESTAURANTES

O restaurante pode: registrar-se independentemente; configurar perfil; cadastrar cardápio; cadastrar produtos; alterar preços; ativar/desativar produtos; receber pedidos; aceitar pedidos; preparar pedidos; marcar pedidos como prontos; visualizar vendas; visualizar pedidos; consultar conta corrente; consultar comissões; enviar comprovativos; consultar pagamentos.

## 18. FLUXO DO PEDIDO DE RESTAURANTE

CLIENTE → Restaurantes → Escolhe restaurante → Visualiza menu → Escolhe produtos → Carrinho → Escolhe entrega → Localização GPS → Mensagem de voz → Método de pagamento → Confirma pedido → RESTAURANTE → Recebe notificação → Aceita → Prepara → Marca "PRONTO" → PLATAFORMA → Procura motorista → MOTORISTA → Aceita → Vai ao restaurante → Recolhe → Vai ao cliente → Entrega → PEDIDO CONCLUÍDO

## 19. FLUXO DE ENTREGA DE DOCUMENTOS/OBJETOS

Exemplo: Cliente quer enviar documentos de Bissau para Safim.

CLIENTE → Enviar → Documento/Objeto → Origem → Destino → Indicação de voz → Preço da frota → Cliente aceita → Pedido criado → Frota → Motorista → Aceita → Recolhe → Entrega → Confirma

A mesma infraestrutura de dispatch deve poder ser reutilizada.

## 20. FARMÁCIAS

Fluxo: Cliente → Farmácias → Escolhe farmácia → Visualiza produtos → Carrinho → Confirma → Farmácia recebe → Prepara → Marca "PRONTO" → Frota → Motorista → Recolhe → Entrega

Produtos sujeitos a restrições legais ou regulatórias devem receber regras específicas antes de serem comercializados através da plataforma.

## 21. LOCALIZAÇÃO

A plataforma NÃO deve utilizar o mapa como interface principal. Isso é uma decisão de produto. Em Bissau existem locais sem nomes de ruas claros, sem numeração, com referências informais, difíceis de localizar somente por endereço.

**GPS**: pode ser capturado silenciosamente. Útil para distância, análise, dispatch futuro, otimização, estatísticas, melhoria do sistema.

**Voz**: a indicação de voz será uma ferramenta central. Exemplo: "Estou perto da escola, depois da farmácia, liga quando chegar." O motorista poderá ouvir a gravação.

## 22. PAGAMENTOS

A V1 não terá gateway de pagamento bancário integrado. O modelo inicial será baseado em: pagamento na entrega, ou Orange Money + comprovativo. O sistema não deve fingir que uma transferência externa foi processada automaticamente.

## 23. ORANGE MONEY

O parceiro poderá registrar: código de comerciante; número; informação necessária para receber pagamentos. O cliente pode utilizar as informações fornecidas para efetuar o pagamento externamente. Depois poderá enviar o comprovativo. O comprovativo será validado manualmente quando necessário.

## 24. COMISSÃO DA PLATAFORMA

A plataforma terá comissão sobre restaurantes e frotas. Não somente sobre restaurantes. A percentagem inicial será 5%. A percentagem deve ser configurável pelo administrador.

## 25. COMISSÃO DO RESTAURANTE

A plataforma acumula 5% sobre a base definida para os pedidos do restaurante. Exemplo: Comida 10.000 FCFA, Comissão 5% = 500 FCFA. O restaurante não precisa pagar essa comissão no momento de cada pedido. Ela fica acumulada na conta corrente.

## 26. COMISSÃO DA FROTA

A frota também paga comissão. Exemplo: Taxa de entrega 1.000 FCFA, Comissão 5% = 50 FCFA. Portanto, a plataforma possui duas fontes de comissão relacionadas à operação: RESTAURANTE 5% + FROTA 5%. As duas contas devem ser separadas.

## 27. EXEMPLO FINANCEIRO COMPLETO

Pedido: Comida 10.000 FCFA + Entrega 1.000 FCFA = Total pago pelo cliente: 11.000 FCFA
O sistema registra: RESTAURANTE (comida 10.000, comissão plataforma 500) e FROTA (entrega 1.000, comissão plataforma 50). A plataforma acumula: 500 + 50 = 550 FCFA.

## 28. PAGAMENTO EM DINHEIRO NA ENTREGA

Este ponto é crítico. Imagine: Comida 10.000 + Entrega 1.000 = TOTAL 11.000 FCFA. O cliente entrega 11.000 FCFA ao motorista. O motorista/frota não pode tratar os 11.000 como se fossem todos seus. O sistema contabiliza: 10.000 FCFA pertencem ao restaurante; 1.000 FCFA pertencem à operação da frota. Portanto, o valor da comida deve ser devolvido ao restaurante.

## 29. COMISSÃO NO PAGAMENTO EM DINHEIRO

A comissão não precisa ser fisicamente retirada do dinheiro no momento da entrega. Ela é registrada contabilmente. Exemplo: Restaurante recebe 10.000 FCFA mas deve 500 FCFA à plataforma; Frota tem 1.000 FCFA de receita mas deve 50 FCFA à plataforma. Portanto: PLATAFORMA 550 FCFA de comissão acumulada. A dívida será posteriormente paga por Orange Money.

## 30. REGRA FINANCEIRA FUNDAMENTAL

Nunca simplesmente alterar um número de saldo. Todas as operações financeiras devem ser registradas como eventos/transações. O sistema deve possuir um modelo de ledger financeiro/audit trail. Deve ser possível saber: pedido que originou a comissão; valor original; comissão; quem deve; pagamento realizado; data; comprovativo; validação; saldo antes; saldo depois.

## 31. PAINEL DO RESTAURANTE

O restaurante deve visualizar claramente: Pedidos totais; Vendas totais; Comissão acumulada; Comissões pagas; Dívida atual; Histórico de pagamentos.

Exemplo: PEDIDOS 125, VENDAS 1.250.000 FCFA, COMISSÃO 62.500 FCFA, PAGO 40.000 FCFA, DÍVIDA 22.500 FCFA. Botão: PAGAR COMISSÃO. O pagamento é feito através do mecanismo Orange Money definido pela plataforma. Depois o restaurante envia o comprovativo. O administrador valida.

## 32. PAINEL DA FROTA

A frota deve visualizar: Pedidos/entregas totais; Valor total das entregas; Motoristas; Entregas por motorista; Quilómetros quando disponíveis; Ganhos; Comissão da plataforma; Comissões pagas; Dívida atual; Histórico.

Exemplo: ENTREGAS 180, VALOR DAS ENTREGAS 180.000 FCFA, COMISSÃO 9.000 FCFA, PAGO 5.000 FCFA, DÍVIDA 4.000 FCFA. Botão: PAGAR COMISSÃO.

## 33. PAINEL DO MOTORISTA

O motorista deve conseguir visualizar: pedidos disponíveis; pedidos aceitos; pedidos atuais; histórico; entregas realizadas; ganhos quando aplicável; informações necessárias para cada entrega; indicação de voz do cliente; estado da entrega.

A experiência deve ser extremamente simples. O motorista está na rua. Não construir uma interface cheia de informações desnecessárias.

## 34. DISPATCH

Quando um pedido estiver pronto para entrega: Pedido pronto → Sistema → Procura operação elegível → Frota → Motoristas disponíveis → Oferta → Motorista aceita → Entrega atribuída

O sistema deve registrar: qual frota recebeu; qual motorista recebeu; horário; aceitação; recolha; entrega; cancelamento quando existir.

## 35. NOTIFICAÇÕES

As notificações são essenciais.
- Restaurante deve receber: Novo pedido.
- Motorista deve receber: Nova entrega.
- Cliente deve receber: Pedido aceito, Pedido em preparação, Pedido pronto, Motorista atribuído, Pedido recolhido, Pedido em entrega, Pedido entregue.

Push notifications devem ser confiáveis. Mas o estado do pedido nunca deve depender somente da notificação. O estado verdadeiro deve existir no backend.

## 36. ESTADOS DOS PEDIDOS

Os pedidos devem utilizar estados claros (ver Aditamento 2 acima — não renomear os já existentes). Estados de exceção: rejeitado, cancelado, falhado. Não permitir mudanças arbitrárias de estados críticos pelo frontend.

## 37. PROVA DE ENTREGA

A plataforma deve ser preparada para suportar prova de entrega. Possibilidades: confirmação do cliente; código; fotografia; assinatura; outro mecanismo futuro. A V1 pode começar simples, mas a arquitetura deve permitir adicionar uma prova de entrega mais forte.

## 38. AVALIAÇÕES

Futuramente: Cliente avalia motorista. Também pode existir: avaliação do restaurante; avaliação da entrega; avaliação do serviço. As avaliações podem posteriormente influenciar qualidade e dispatch. Não criar sistemas de penalização complexos antes de haver dados suficientes.

## 39. MÉTRICAS DA FROTA

A plataforma deve registrar dados suficientes para posteriormente calcular: número de pedidos; entregas concluídas; cancelamentos; tempo médio; distância; quilometragem; ganhos; desempenho por motorista; desempenho da frota. O sistema deve distinguir dado registrado de métrica calculada.

## 40. QUILOMETRAGEM

A quilometragem é uma funcionalidade estratégica para o painel da frota. Objetivo futuro: Motorista → Entregas → Distância percorrida → Km por dia/semana/mês. Na V1, se a medição GPS ainda não for suficientemente confiável, não apresentar valores estimados como se fossem precisos.

## 41. TRANSPORTE DE PASSAGEIROS — FUTURO

A plataforma poderá posteriormente incluir mototáxi e táxi. Fluxo: Cliente → Transporte → Origem → Destino → Preço → Aceita → Motorista → Recolhe cliente → Transporte → Destino

Transporte de passageiros possui regras próprias. Antes de implementar essa vertical deverão ser definidas: segurança; identificação; preço; cancelamento; responsabilidade; documentação; requisitos dos motoristas; regras legais aplicáveis. Não misturar automaticamente a lógica de delivery com transporte de passageiros.

## 42. FUTURO — MOTORISTAS INDIVIDUAIS

Quando a plataforma estiver madura: Tenho uma moto → Quero trabalhar → Cadastro como motorista → Sistema verifica requisitos → Ativação → Recebo pedidos. Esse modelo será separado do modelo de frota. A arquitetura deve suportar ambos.

## 43. FUTURO — PREÇO POR KM

Depois da evolução para motoristas individuais: Origem → Destino → GPS → Distância → Preço/km → Preço final → Cliente aceita. A plataforma poderá definir a fórmula. Isso permitirá uma operação mais automatizada.

## 44. FUTURO — INTELIGÊNCIA LOGÍSTICA

Depois de existir volume suficiente de dados: Dispatch inteligente (escolher melhor motorista com base em localização, disponibilidade, distância, tempo, carga, desempenho); Pedidos em cadeia; Batching; Otimização de rotas; IA (só quando houver dados suficientes para justificar sua utilização).

## 45. BORNAAL — LIMPEZA OBRIGATÓRIA

O projeto atual nasceu a partir de uma cópia/derivação do Bornaal. O DeliveryApp deve tornar-se completamente independente. Investigar e limpar: bornaal_id; branding; textos; imagens; localStorage; storage; endpoints; notificações; VAPID; chaves; URLs; variáveis de ambiente; tabelas; triggers; funções; código morto; referências internas. Não assumir que qualquer configuração herdada está correta.

## 46. SEGURANÇA

Segurança é prioridade. O sistema deve garantir isolamento completo. Exemplo: Frota A não vê motoristas da Frota B; Restaurante A não vê dados privados do Restaurante B; Motorista A não altera motorista B; Frota não altera restaurante; Cliente não acessa administração.

A segurança deve existir no backend/database. Não confiar apenas em `if (user.role === ...)` no frontend.

## 47. RLS

**Antes de dar qualquer política por verificada, ver a REGRA DE ENGENHARIA no topo deste ficheiro:** um teste de RLS feito com `service_role` não testa RLS nenhum.

Se Supabase estiver sendo utilizado, as políticas RLS devem ser auditadas cuidadosamente. Verificar: SELECT; INSERT; UPDATE; DELETE; funções; triggers; views; relações; ownership; roles. Toda informação privada deve possuir autorização adequada.

## 48. AUTENTICAÇÃO E DADOS

O mecanismo de telefone + PIN existente deve ser analisado antes de qualquer alteração. Não alterar o formato de password/PIN simplesmente para "melhorar" o código. Uma alteração de autenticação pode bloquear todos os utilizadores existentes. Qualquer migração deve possuir: plano; compatibilidade; migração; testes; rollback quando necessário.

## 49. AMBIENTE

Auditar explicitamente: Supabase URL; anon key; service role; VAPID; push; storage; endpoints; domínio; variáveis de ambiente. Nunca colocar secrets no frontend. Nunca armazenar credenciais administrativas em código público.

## 50. DESIGN SYSTEM

A experiência deve ser: mobile-first; simples; rápida; clara; acessível; adaptada à realidade local. Princípios: botões grandes; textos legíveis; poucos passos; ícones quando úteis; baixo consumo de dados; grelha de categorias; evitar carrosséis escondidos; navegação simples.

Cor principal atual: HSL 145 63% 32%. Fundo: creme quente. O design pode evoluir, mas deve manter clareza acima de decoração.

## 51. EXPERIÊNCIA DO MOTORISTA

O motorista pode estar na rua, em movimento, usando uma mão, com internet limitada. A interface deve priorizar: pedido atual; endereço/indicação; botão de aceitar; botão de recolher; botão de entregar; comunicação; navegação. Nada desnecessário deve competir com essas ações.

## 52. EXPERIÊNCIA DO CLIENTE

O cliente deve compreender imediatamente: O que posso fazer? Quanto vou pagar? O que aconteceu com o meu pedido? Quem está cuidando dele? Quando será entregue? Evitar jargão técnico.

## 53. CONTA CORRENTE

Restaurantes e frotas terão contas correntes independentes. Cada conta deverá apresentar: Saldo devido + Histórico + Comissões + Pagamentos + Comprovativos. O saldo deve ser calculado a partir do ledger. Não depender de edição manual de um único campo de saldo.

## 54. PAGAMENTO DE COMISSÕES

Fluxo: Parceiro → Clica "Pagar comissão" → Visualiza valor devido → Recebe instruções Orange Money → Faz pagamento → Envia comprovativo → Admin recebe → Admin valida → Pagamento registrado → Dívida atualizada. Se o pagamento for rejeitado: Dívida permanece.

## 55. ADMINISTRAÇÃO FINANCEIRA

O administrador deve visualizar: comissões dos restaurantes; comissões das frotas; pagamentos; comprovativos; dívidas; histórico; pedidos; valores. Deve ser possível identificar exatamente de onde veio cada valor.

## 56. AUDITORIA FINANCEIRA

Nunca apagar silenciosamente transações financeiras. Se algo precisar ser corrigido: criar uma nova transação de correção. Não reescrever o histórico de forma que a operação original desapareça.

## 57. V1 — O QUE DEVE SER PRIORIDADE

A primeira versão operacional deve concentrar-se em três fluxos completos: (1) Cliente → Restaurantes → Pedidos → Checkout → GPS+voz → Pagamento → Restaurante → Frota → Motorista → Entrega → Conclusão → Financeiro; (2) Cliente → Entrega de documento/objeto → Frota → Motorista → Entrega; (3) Cliente → Farmácia → Pedido → Frota → Motorista → Entrega.

## 58. O QUE NÃO IMPLEMENTAR AGORA

Não transformar a V1 em um super app completo. Não implementar prematuramente: motorista individual; marketplace aberto de motoristas; preço por km obrigatório; dynamic pricing; IA de dispatch; batching; pedidos em cadeia; sistema completo de táxi/mototáxi; gateway bancário; Quick Commerce; dark stores; funcionalidades desnecessárias. A arquitetura pode ser preparada para essas coisas, mas a implementação deve ser progressiva.

## 59-69. ROADMAP EM FASES

- **Fase 0 — Autópsia do projeto**: auditar código, banco, segurança, autenticação, notificações, ambiente, Bornaal, dados; mapear problemas. Resultado: documento de diagnóstico técnico.
- **Fase 1 — Fundação**: autenticação, perfis, roles, RLS, banco, navegação, design system, configuração, isolamento de contas.
- **Fase 2 — Restaurantes**: cadastro, perfil, cardápio, produtos, carrinho, checkout, pedidos, estados, painel, notificações.
- **Fase 3 — Frotas**: cadastro da frota, painel, motoristas, associação motorista/frota, ativação/desativação, preços por bairro, disponibilidade, métricas.
- **Fase 4 — Motoristas**: login, painel, disponibilidade, pedidos, aceitar, recolher, entregar, voz, histórico, ganhos.
- **Fase 5 — Dispatch**: criação da entrega, seleção de frota/motorista, notificações, aceitação, recolha, entrega, cancelamento, acompanhamento.
- **Fase 6 — Financeiro**: ledger, comissão restaurante, comissão frota, conta corrente, pagamentos, comprovativos, validação admin, histórico.
- **Fase 7 — Entregas**: categoria Enviar, documentos, objetos, origem, destino, voz, preço, dispatch, entrega.
- **Fase 8 — Farmácias**: cadastro, catálogo, pedidos, preparação, entrega, regras específicas.
- **Fase 9 — Polimento**: traduções (Português, Francês, Crioulo), UX, performance, acessibilidade, notificações, prova de entrega, avaliações, segurança.
- **Fase 10 — Evolução**: motoristas individuais → preço por KM → GPS avançado → dispatch inteligente → pedidos em cadeia → batching → IA → mototáxi → táxi → lojas → supermercados.

## 70. PRINCÍPIO DE ESCALABILIDADE

A plataforma deve ser modular. O conceito de pedido deve ser suficientemente flexível para suportar diferentes verticais (Restaurant Order, Pharmacy Order, Delivery Order, Future Store Order, Future Transport Order). Mas cada vertical deve possuir regras específicas quando necessário. Não criar um sistema tão genérico que fique impossível de manter.

## 71. PRINCÍPIO DE DADOS

Dados importantes devem possuir uma única fonte de verdade: Pedido (backend/database); Saldo (ledger financeiro); Estado da entrega (backend/database); Disponibilidade do motorista (backend/database); Notificação (mecanismo de comunicação, não fonte de verdade).

## 72. PRINCÍPIO DE CONFIABILIDADE

Se uma notificação falhar, o pedido continua existindo. Se o frontend fechar, o pedido continua existindo. Se o motorista perder internet temporariamente, o sistema não deve criar pedidos duplicados. Operações importantes devem ser idempotentes quando apropriado.

## 73. DUPLICAÇÃO DE PEDIDOS

O sistema deve prevenir: pedidos duplicados; pagamentos duplicados; atribuições duplicadas; comissões duplicadas. Especialmente em situações de refresh, conexão lenta, retry, push duplicado, utilizador tocando várias vezes no botão.

## 74. OBSERVABILIDADE

O sistema deve registrar eventos importantes: pedido criado/aceito/rejeitado; restaurante marcou pronto; frota recebeu; motorista aceitou/recolheu/entregou; pedido cancelado; pagamento enviado/validado. Isso será essencial para investigar problemas.

## 75. REGRA SOBRE IA

Não usar IA simplesmente porque é possível. IA deve resolver problemas reais. Possíveis usos futuros: previsão de demanda; dispatch; previsão de tempo; otimização de rotas; detecção de fraude; previsão de disponibilidade; suporte ao cliente. Primeiro dados confiáveis, depois inteligência sobre esses dados.

## 76. FILOSOFIA DO PRODUTO

O DeliveryApp deve seguir três princípios: SIMPLES (o cliente entende rapidamente); LOCAL (construído para Bissau e a realidade guineense); ESCALÁVEL (a arquitetura permite crescer para outras categorias e cidades).

## 77. VISÃO DE LONGO PRAZO

O objetivo não é permanecer apenas como um aplicativo de restaurantes. A evolução pretendida: DELIVERY → LOGÍSTICA → MOBILIDADE → SERVIÇOS → ECOSSISTEMA. O cliente poderá eventualmente utilizar a mesma plataforma para comer, comprar, enviar, receber, deslocar-se.

## 78. DIFERENCIAL LOCAL

O DeliveryApp não deve simplesmente copiar interfaces estrangeiras. Deve compreender que: uma mensagem de voz pode ser mais útil que um endereço formal; uma referência local pode ser mais útil que um número de rua; pagamento Orange Money pode ser mais realista que um gateway sofisticado; preço por bairro pode ser mais funcional inicialmente que cálculo exato por GPS; uma frota local pode ser mais eficiente para o lançamento que tentar criar milhares de motoristas individuais.

## 79. MODELO OPERACIONAL INICIAL

RESTAURANTES → pedidos → DELIVERYAPP → dispatch → FROTAS → distribuição → MOTORISTAS → entrega → CLIENTES

Financeiramente: CLIENTE → pagamento → OPERAÇÃO → (Restaurante / Frota / Plataforma). A plataforma registra contabilmente cada parte.

## 80. MODELO FINANCEIRO INICIAL

Exemplo: Cliente paga 11.000 FCFA (Comida 10.000 + Entrega 1.000). Contabilidade: Restaurante 10.000 - 500 comissão = 9.500 líquido; Frota 1.000 - 50 comissão = 950 líquido; Plataforma 550 FCFA. A comissão permanece como dívida até o parceiro pagar.

## 81. ALTERAÇÕES FUTURAS DO MODELO

A plataforma poderá modificar comissão, método de cálculo, preço, regras de operação, categorias. Mas mudanças importantes devem ser documentadas, versionadas, comunicadas, implementadas com cuidado, compatíveis com contratos existentes quando aplicável.

## 82. CONTRATOS

Os contratos com restaurantes e frotas devem refletir o modelo operacional: comissão; responsabilidade; pagamento; comprovativos; regras de operação; alteração futura de preços/modelos; suspensão; cancelamento; responsabilidades. Quando houver mudança estrutural relevante no modelo comercial, deve-se verificar a necessidade de atualização contratual.

## 83. PRINCÍPIO DE NÃO SURPRESA

O cliente deve sempre saber: o que está pedindo; preço da comida; taxa de entrega; total; método de pagamento. O restaurante deve saber: vendas; comissão; dívida. A frota deve saber: entregas; ganhos; comissão; dívida. O motorista deve saber: pedido; destino; remuneração quando aplicável; estado.

## 84. PRINCÍPIO DE TRANSPARÊNCIA FINANCEIRA

Nunca apresentar "Você deve X" sem que o sistema consiga explicar "Você deve X porque estas foram as transações que geraram esse valor." Cada dívida deve ser rastreável.

## 85. CRITÉRIO DE SUCESSO DA V1

A V1 será considerada operacional quando conseguirmos realizar de ponta a ponta: Cliente → Restaurante → Pedido → Pagamento → Restaurante prepara → Frota recebe → Motorista aceita → Motorista recolhe → Motorista entrega → Cliente confirma → Comissão registrada → Restaurante vê dívida → Frota vê comissão/dívida. E também: Cliente → Enviar documento → Frota → Motorista → Entrega → Conclusão. Sem depender de processos manuais escondidos no código.

## 86. ORDEM DE PRIORIDADE

Quando houver conflito entre funcionalidades, priorizar: 1) Segurança; 2) Integridade dos dados; 3) Pedidos; 4) Dispatch; 5) Entrega; 6) Financeiro; 7) Notificações; 8) UX; 9) Métricas; 10) Funcionalidades futuras. Não sacrificar segurança ou integridade para lançar uma feature mais rapidamente.

## 87. INSTRUÇÃO FINAL PARA O CLAUDE CODE

Este documento representa a visão atual do produto. Trata-o como Product Requirements + Business Rules + Engineering Direction. Porém, não assumas que o código atual está alinhado com ele.

Primeiro faz a autópsia. Depois compara: VISÃO DESEJADA vs CÓDIGO ATUAL.

Classifica cada área como:
- 🟢 PRESERVAR — está correta e pode continuar.
- 🟡 MODIFICAR — existe, mas precisa ser adaptada.
- 🔴 RECONSTRUIR — a implementação atual está incompatível com a visão.
- ⚫ REMOVER — código morto, legado ou dependência indevida.

Depois produz um plano técnico. Só então começa a implementação por fases.

## 88. REGRA ABSOLUTA

Não construir uma cópia superficial do Glovo. Construir uma plataforma própria. Aprender com Glovo, Uber Eats, Yango — mas adaptar tudo à realidade da Guiné-Bissau.

O objetivo final é criar uma infraestrutura digital de delivery, logística e mobilidade para a Guiné-Bissau. Começar pequeno. Operar. Medir. Aprender. Melhorar. Escalar.

FIM DO DOCUMENTO

---

## Primeira tarefa do Claude Code

Não programe imediatamente. Primeiro responda com uma auditoria completa do repositório atual, incluindo: arquitetura; stack; páginas; componentes; banco de dados; tabelas; relações; RLS; autenticação; roles; storage; notificações; pagamentos; lógica de pedidos; lógica de restaurantes; lógica de motoristas; lógica de frotas existente; referências ao Bornaal; problemas de segurança; problemas de dados; funcionalidades que já funcionam; funcionalidades ausentes; código que deve ser removido; código que deve ser preservado; proposta de arquitetura futura.

Depois disso, apresente um Plano de Reconstrução do DeliveryApp por fases, indicando: objetivo da fase; arquivos afetados; tabelas afetadas; migrations necessárias; riscos; testes; critérios de conclusão.

**Aguarde aprovação antes de executar uma reconstrução estrutural completa.**

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

## 2026-09-10
- **Pagamento em dinheiro na entrega: o cliente paga ao MOTORISTA.** §28 do
  documento mestre está correto. O motorista recebe o total (comida + entrega),
  fica com a taxa de entrega, e **deve o valor da comida ao restaurante**.
  O fluxo é motorista → restaurante, nunca restaurante → motorista.

  Fica registado porque a direção já foi trocada uma vez por engano num prompt,
  e o indicador de "pago" que o Prompt B vai construir fica errado para um dos
  lados se for pelo sentido contrário: quem vê "tenho a receber" é o
  restaurante, e quem vê "tenho a entregar" é o motorista.

  Isto é contabilístico, não físico: §29 diz que a comissão da plataforma não é
  retirada do dinheiro no momento da entrega, é registada e paga depois.

- **`deliveries` fica inacessível à leitura directa pelo dono da frota.** Sem
  policy nova. A policy `Deliveries viewable by involved` cobre o motorista, o
  cliente, o dono do restaurante e o admin — a frota está fora, de propósito.

  A frota chega aos seus dados pelas RPCs `SECURITY DEFINER`
  (`get_fleet_metrics`, `get_fleet_drivers`, `get_fleet_driver_detail`), que
  decidem o que expor, em vez de a tabela inteira ficar aberta a mais um papel.

  **Porque isto está escrito:** uma leitura directa de `deliveries` com o JWT da
  frota devolve **lista vazia, sem erro**. Código novo no painel da frota que
  leia a tabela vai parecer que funciona e não mostra nada. Se precisares de
  mais um dado do lado da frota, acrescenta-o a uma RPC — não acrescentes uma
  policy sem falar com o dono do projeto. Também registado em
  `COMMENT ON TABLE public.deliveries` e no comentário da própria policy.

---

# Decisões de sub-fases confirmadas

**Porque esta secção existe.** As sub-fases (2.1, 2.2, 2.3, …) não constam do
roadmap por fases do documento mestre — foram sendo combinadas em conversa. Até
2026-09-16 essas decisões só existiam no diálogo: quando uma nova sessão pegava
no trabalho, "já combinado" não estava escrito em lado nenhum e era preciso
perguntar outra vez, ou pior, adivinhar. Tudo o que for decidido para uma
sub-fase entra aqui **antes** de se escrever código.

## Fase 2.3 — Fecho de caixa — CONCLUÍDA (2026-09-16)

O problema: §28 manda o cliente pagar ao motorista, que deve a comida ao
restaurante. A Fase 6 registava a dívida (`divida_comida`/`credito_comida`) e
não tinha forma nenhuma de a saldar — `pagamento_comissao` só serve a dívida à
plataforma (§54). A dívida entre frota e restaurante crescia e nunca descia.

- **Liquidação real, não relatório.** A frota **declara** o dinheiro que
  entregou; o restaurante **confirma** (liquida o ledger) ou **contesta** (a
  dívida fica de pé, com o motivo registado). Tabela `cash_settlements`, estados
  `declarado`/`confirmado`/`contestado`/`cancelado`.
- **Quem confirma é o RESTAURANTE**, não o admin. É o dinheiro dele; a
  plataforma não tem de estar no meio de cada acerto diário. Mesmo padrão do §54
  (declara → alguém valida), com o validador trocado.
- **Contestar exige motivo.** Sem ele a frota recebe "não" sem saber o que
  corrigir (§84).
- **Teto contra a dívida VIVA**, e o teto conta também o que já está declarado
  por confirmar. Sem isso, três declarações de 10.000 sobre uma dívida de 10.000,
  todas confirmadas, davam −20.000. A confirmação revalida no momento, porque um
  cancelamento pelo meio pode ter reduzido a dívida (§56).
- **Aba "Caixa" separada de "Financeiro"** no painel da frota. Não se somam: ali
  é comissão devida à plataforma (§26), aqui é dinheiro de terceiros que passou
  pelas mãos do motorista (§28). Juntos levavam a frota a pensar que devia o
  total a uma pessoa. No restaurante fica dentro da conta corrente, que é onde
  ele já vem perguntar "quanto tenho a haver".

**Armadilha registada para quem mexer no ledger a seguir:** as funções de
leitura da Fase 6 (`get_business_commission`, `get_fleet_financials`) somam por
`entry_type` EXACTO, não por contraparte. Um `entry_type` novo, por mais
correcto que tenha o sinal, **não aparece em conta nenhuma** enquanto essas
funções não o conhecerem — a liquidação parece funcionar e a dívida fica igual
no ecrã. Ao acrescentar um tipo, ensinar os leitores no mesmo passo.

## Fase 2.4 — Pedidos manuais — decisões tomadas

O restaurante tem de poder lançar no sistema um pedido que não veio pela app
(telefone, balcão, cliente habitual). Sem isso o stock e as vendas do painel
mentem sobre a operação real.

1. **Mesma tabela `orders`**, marcado com `source = 'manual'`. Não é uma tabela
   nem um fluxo paralelo — §70 quer o conceito de pedido flexível, não
   duplicado.
2. **Pode pedir entrega, e é opcional.** Um pedido manual tanto pode ser
   consumido no local como sair para entrega pela frota, pelo mesmo dispatch.
3. **O stock desconta na CRIAÇÃO do pedido**, não na confirmação. O pedido
   manual já é um facto consumado quando é lançado — a comida já saiu.
4. **A reposição de stock é manual.** Não reinicia ao abrir nem ao fechar o dia;
   quem repõe é o dono, por `set_menu_item_stock`, e fica registada em
   `stock_adjustments` como qualquer outra.
5. **Pedido manual NÃO gera comissão da plataforma.** A plataforma não trouxe
   este cliente.

**O ponto 5, precisado a 2026-09-16** (a primeira leitura isentava as duas
comissões; corrigido no mesmo dia):

- **Comissão do restaurante (§25): isenta SEMPRE** num pedido manual. Ele não
  usou a plataforma para conseguir este cliente — o cliente ligou, ou entrou
  pela porta.
- **Comissão da frota (§26): aplica-se quando o pedido manual usa ENTREGA.** Aí
  o motorista fez trabalho real através do despacho da plataforma, e essa parte
  gera comissão como qualquer outra entrega despachada.

A distinção é sobre **quem usou a plataforma para quê**. O restaurante não a usou
para vender; a frota usou-a para entregar. São duas perguntas diferentes e
tinham a mesma resposta por engano.

O que **continua a acontecer** num pedido manual pago a dinheiro é a dívida de
comida da frota ao restaurante (§28): isso não é comissão, é dinheiro de
terceiros, e tem de ser sempre registado — isentá-la reabria o buraco que a
Fase 2.3 fechou.

**Rótulo, mesma data:** na conta corrente do restaurante, "Vendas" passou a
"Vendas sujeitas a comissão" (`currentAccount.totalSales`, nos 4 idiomas). Esse
número sai do ledger e por isso **não** inclui os pedidos manuais, enquanto a aba
Vendas conta a tabela `orders` inteira. Os dois estão certos e vão divergir; o
rótulo antigo levava um restaurante com muitos pedidos manuais a pensar que
estava a perder vendas.

## Fase 2.5 — Horários e galeria — CONCLUÍDA (2026-09-16)

A última sub-fase da Fase 2. **Estas decisões foram tomadas por mim, não pelo
dono** — ficam aqui para serem confirmadas ou trocadas, e cada uma é reversível
numa linha.

**Horários**

- **Sem horário definido = sempre aberto.** É o único default seguro: há
  restaurantes reais em produção que nunca vão abrir este ecrã, e um default de
  "fechado" fechava-os a todos no momento em que a migração corresse.
- **O horário TRAVA o pedido, não é decoração.** §46 põe a regra no backend;
  mostrar "Fechado" e aceitar o pedido a seguir mentia aos dois lados.
- **Interruptor manual `profiles.accepting_orders`**, independente do horário —
  fecha já (acabou o peixe, acabou o gás) sem obrigar o dono a editar o horário
  e depois lembrar-se de o repor.
- **O pedido manual (2.4) NÃO é travado**: quem o lança é o próprio restaurante,
  que sabe se está aberto.
- **Vários períodos por dia** (almoço/jantar), e `closes_at <= opens_at`
  significa que o período atravessa a meia-noite e conta no dia em que **abre** —
  19:00→02:00 numa sexta mantém a loja aberta à 01:00 de sábado. É o caso que uma
  comparação ingénua erra sempre, e erra em silêncio, na noite de mais movimento.
- **Fuso:** a Guiné-Bissau é UTC+0. Guarda-se e compara-se em UTC, sem conversão.
  Não "corrigir" isto com um `AT TIME ZONE` — introduzia um desvio.

**Galeria**

- **Reaproveita `portfolio_images` e o bucket `portfolio`**, que já existiam para
  a vertical de beleza e já têm as policies certas (dono gere a sua, toda a gente
  lê). A tabela é exactamente uma galeria com chave em `profiles.id`. Criar uma
  paralela só para restaurantes acrescentava uma segunda verdade sobre a mesma
  coisa (§10). **Não é tabela morta** — `ProviderDetail` e `BeautyEdit` usam-na.
- Leitura pública de propósito: é a montra, e o cliente vê-a antes de ter conta,
  como já vê o menu. Máximo de 12 fotos, 5 MB cada.

## Fase 7 — Categoria "Enviar" — CONCLUÍDA (2026-09-16)

Documentos e objetos (§19), reutilizando **o mesmo dispatch** das Fases 3 e 5 —
`offer_delivery_to_fleet`, `dispatch_attempts`, `expire_stale_dispatch`. Nenhum
tubo paralelo.

**Modelo.** Um envio é um `order` com `kind = 'envio'`, sem `business_id`. O
CHECK `orders_kind_coerente` amarra tudo: restaurante exige `business_id`; envio
exige `business_id` nulo, `consumption_option = 'entrega'` **e `total = 0`**.

> **O `total = 0` não é cosmético.** O `ledger_registar_conclusao` decide o que
> escrever a partir de `v_total > 0`. Com zero, salta a comissão do restaurante
> (§25) e a dívida de comida (§28) e sobra a comissão da frota (§26) — o correcto.
> Se um envio pudesse ter total > 0, o ledger escrevia `comissao_restaurante` com
> `business_id` nulo e batia no CHECK do próprio ledger **na conclusão**, depois
> de o motorista já ter trabalhado.

**Preço:** pelo bairro de **destino**, via `fleet_zone_prices` (§13/§15). O
`pickup_bairro` é guardado para a evolução do §16 mas **não entra na conta hoje** —
um envio Bissau→Safim e um dentro do mesmo bairro custam o mesmo se o destino for
igual. Limitação aceite.

**Origem:** reutiliza `deliveries.restaurant_lat/lng/address`, que são um ponto de
recolha genérico com nome infeliz. Não foram renomeadas — mexeria em muitas
funções por ganho cosmético.

**Duas gravações de voz**, não uma. Numa entrega de restaurante a origem tem
morada; num envio a origem é o sítio mais difícil de explicar (§21, §78), e o
motorista precisa dela **primeiro**. No painel dele aparece antes da de entrega e
desaparece depois de recolher.

**Decisões operacionais:**

- **Recusa criar se nenhuma frota cobrir o destino.** Sem frota não há preço para
  o cliente aceitar (§14), e o envio ficaria preso para sempre: não tem
  restaurante que o reofereça, o `expire_stale_dispatch` não lhe toca (a ronda
  nasceria `sem_frota`, fechada) e o `alert_stuck_orders` também não (tem entrega).
- **Só dinheiro na entrega.** O pagamento online usa o `merchant_code` do parceiro
  (§23) e um envio não tem parceiro.
- **Cancelamento:** o cliente cancela enquanto **nenhum motorista aceitou**
  (`novo` ou `aguardando_motorista`). A regra da Fase 1 ("só em `novo`") nasceu do
  momento em que o restaurante confirma; aqui o compromisso equivalente é o
  motorista aceitar. Sem isto o cliente nunca conseguiria cancelar um envio.
- **Sem transição nova na matriz.** O envio nasce em `aguardando_motorista`, e um
  estado *inicial* não passa pela matriz (que só governa UPDATEs) — como o
  `create_manual_order` nasce em `confirmado`. Alargar o §36 para um caminho que
  ninguém percorre só o enfraquecia.
- **Idempotência (§73):** sem chave natural, a assinatura do pedido numa janela de
  90s (mesmo cliente, mesma origem, mesmo destino, por aceitar). O segundo toque
  devolve o pedido já criado em vez de rebentar.
- **Entrada na UI:** ecrã inicial, não `BottomNav` — "Enviar" é categoria da
  plataforma (§4), e a barra já tem 5 itens (§50).

**Armadilha permanente, descoberta aqui:** várias funções faziam
`INNER JOIN profiles ON p.id = o.business_id`. Um pedido sem restaurante
**desaparecia sem erro** — lista vazia, HTTP 200. Passaram a `LEFT JOIN`:
`get_available_deliveries`, `get_my_deliveries`, `alert_stuck_orders`,
`expire_stale_dispatch`. **Continuam `INNER` de propósito** as de *autorização* —
`reoffer_delivery` e `validate_order_payment` — porque um envio não tem dono de
restaurante e nenhum o deve poder reoferecer ou validar-lhe o pagamento. Há
asserções nas migrações que rebentam se alguém as "corrigir".

## Fase 9 — Polimento — decisões tomadas (2026-09-16)

Dividida em 5 sub-fases, por esta ordem: **9.1** bugs de runtime e triagem de
`tsc`/`eslint` · **9.2** desempenho e estados de erro · **9.3** prova de entrega
· **9.4** avaliações · **9.5** traduções. As traduções ficam no fim porque a 9.3 e
a 9.4 criam ecrãs novos — traduzir antes seria traduzir duas vezes.

1. **Prova de entrega: código OU foto obrigatórios.** Desaparece o botão "Sem
   código", que concluía a entrega sem deixar rasto nenhum. O motorista tem
   sempre uma saída se um dos métodos falhar (telemóvel do cliente sem bateria,
   sem rede). **Imposto no backend** (`complete_delivery`), não só escondendo o
   botão (§46). Porque importa além do óbvio: concluir uma entrega dispara o
   ledger — num pedido a dinheiro fica registada dívida de comida e comissão, e
   sem prova isso acontecia para entregas que nada provava terem existido (§86,
   prioridade 2). **Esta sub-fase toca na função que dispara o ledger: correr o
   teste do ciclo concluir → cancelar → reconcluir depois de mexer.**

2. **Avaliações V1: restaurante e motorista, por pedido concluído, uma vez cada,
   sem inserção anónima.** O modelo actual é o do Bornaal (`provider_id` +
   `service_requests`) e não liga a pedidos nem a motoristas — fica intacto para
   a vertical de beleza. Sem sistemas de penalização: §38 manda esperar por
   dados.

3. **Kriol: escrito por mim, MARCADO para revisão por falante nativo antes de
   produção.** Não é tradução validada. **Termos e Privacidade (34 chaves) NÃO se
   traduzem** sem essa revisão: é texto com valor legal, e um erro ali é pior do
   que ficar em português por agora.

4. **As ~170 chaves dos ecrãs do Bornaal ficam fora do Kriol** (`providerDashboard`,
   `providerDetail`, `requests`, `beautyEdit`) — pertencem ao bloco de limpeza do
   Bornaal, que é separado.

**9.1 e 9.2 — concluídas.** `tsc` 18 → 4, `eslint` 9 erros → 0. Primeira carga do
cliente 360 → 262 KB gzip. **Os 4 que restavam saíram entretanto: a 2026-09-20
`tsc --noEmit` e `eslint` estão os dois a zero.**

**9.3 — Prova de entrega — CONCLUÍDA.** Imposta por um trigger `BEFORE UPDATE` em
`orders` (`exige_prova_de_entrega`), que apanha os **seis** caminhos que levavam uma
entrega a `concluido` — só um exigia prova. Três coisas que quem mexer aqui a
seguir tem de saber:

- **O restaurante perdeu o fallback** de concluir uma entrega por conta do
  motorista. É a leitura fiel da decisão: ele não está na entrega e não a pode
  provar. A saída para o motorista sem telemóvel é a **válvula do admin**, isenta
  do trigger e registada no histórico.
- **`create_delivery_proof` ignora `p_qr_validated`.** Antes aceitava-o do cliente,
  e um motorista declarava o código validado sem código nenhum. Só
  `validate_delivery_code` escreve `qr_validated = true`.
- **O código bloqueia ao 5.º erro** — mesmo com o código certo a seguir — e a
  saída passa a ser a fotografia. O limite não é um beco sem saída.
- **Os testes antigos que concluíam com `complete_delivery` sozinho deixaram de
  passar, de propósito:** codificavam o caminho inseguro. Um teste que conclua uma
  entrega tem de validar o código ou enviar foto primeiro (ou usar o admin).

**Achado da auditoria que é erro meu:** a UI das Fases 2.3 a 7.3 foi escrita com
texto fixo em português, fora do i18n (~57 frases em 6 ficheiros). O contador de
cobertura dizia 100% em en/fr porque conta as chaves que existem, e esses ecrãs
não tinham chave nenhuma. **Regra daqui em diante: texto de interface novo entra
já com chave nos 4 ficheiros.**

**9.4 — Avaliações — CONCLUÍDA (2026-09-20).** Tabela nova `order_ratings`, que
**não** reaproveita a `reviews` do Bornaal (essa fica de pé para a beleza). A
antiga é uma montra sem pedido por trás; esta só existe agarrada a um pedido
concluído. Juntá-las dava uma média que mistura quem comprou com quem passou pela
página.

**Três decisões do dono, tomadas depois de a auditoria mostrar a colisão:**

1. **O formulário aberto da página do restaurante SAIU.** Descoberta durante a
   fase: `BusinessDetail` já tinha uma caixa de avaliação que aceitava qualquer
   visitante, sem pedido nenhum e **anonimamente**. Enquanto existisse, o caminho
   antigo continuava aberto e o novo era decorativo.
2. **A policy de INSERT anónimo em `reviews` foi removida por inteiro**, também
   para a beleza. Custo real zero: a tabela nunca teve uma linha. **Isto contraria
   a nota da Fase 1** que a dava como "de propósito" — foi decisão explícita do
   dono, não esquecimento.
3. **A avaliação aparece logo**, sem moderação prévia. Quem avalia já provou que
   fez o pedido, portanto a fraude que a moderação travava está travada à entrada.
   O admin mantém poder de apagar (policy DELETE).

**Desenho, e porquê:**

- **`authenticated` NÃO tem INSERT na tabela.** Escreve-se só por `rate_order`.
  Não é preciosismo: com INSERT directo o cliente escolhia `business_id` e
  `driver_id`, e um 5 no restaurante preferido não custava um pedido. O servidor
  deriva os dois do próprio pedido — **o motorista sai da entrega**, nunca de um
  parâmetro.
- **Sem policy de UPDATE.** Uma avaliação não se reescreve; se estiver errada, o
  admin apaga.
- **`UNIQUE (order_id, target)`** e não um SELECT antes do INSERT, que perde a
  corrida entre dois toques no botão (§73). A `unique_violation` é apanhada e
  devolvida como "Este pedido ja foi avaliado".
- **Um envio não tem restaurante para avaliar** (`business_id` nulo), mas **tem
  motorista** — e esse avalia-se.
- **A média do motorista NÃO é pública**: só o próprio, o dono da frota e o admin.
  §38 não pede montra de motorista, e expô-la era o primeiro passo para a
  penalização que §38 manda adiar.
- **`driver_id` é `ON DELETE SET NULL`**: se um motorista sair, a avaliação do
  pedido não desaparece (§56).

**Testado por HTTP real com JWT normal** (`scripts/avaliacoes-test.mjs`, 19
assertivas, nunca `service_role`): não se avalia pedido alheio, nem duas vezes,
nem por concluir, nem com 0/6/−1 estrelas, nem anonimamente; **o INSERT directo na
tabela é recusado** (403) — caminho que uma RPC verde não prova.

**Duas armadilhas apanhadas a escrever o teste, ambas assertivas verdes sobre
nada:**

- `create_send_order` devolve um **objecto** (`{order_id, …}`), não um uuid. Passar
  o objecto fazia a recusa vir de erro de sintaxe de uuid, não da regra. Um teste
  que passa pela razão errada é pior que um que falha.
- O `delivery_id` de um **envio** lido com o token do motorista vem **vazio, sem
  erro** — a policy só lhe mostra entregas já dele, e um envio não tem dono de
  restaurante. Lê-se com o token do cliente.

**Aviso para quem correr o teste:** ele leva pedidos até `concluido`, o que
**escreve no ledger real**. A limpeza completa (com a desactivação temporária de
`ledger_entries_sem_delete`) é impressa pelo próprio script no fim. A corrida de
2026-09-20 pôs 17 linhas no ledger e foi limpa: 19 lançamentos reais intactos.

**9.5 — Traduções — texto fixo dos ecrãs 2.3–7.3 fechado (2026-09-21).** Fecha o
achado da auditoria da Fase 9 ("~57 frases em 6 ficheiros"). Eram **sete**
ficheiros, não seis: a contagem deixou de fora os dois da Fase 2.5
(`BusinessHoursEditor`, `BusinessGallery`, criados no mesmo commit `5f455ce`).

**A armadilha central, e a razão de este parágrafo existir.** Três dos ficheiros
(`FleetCashClosing`, `BusinessCashSettlements`, `ManualOrderDialog`) tinham sido
convertidos para `t("fleetCash.…")` **sem que os namespaces chegassem a ser
criados em ficheiro nenhum** — 59 chaves. O i18next, quando não encontra a
chave, **devolve o nome da chave**: o ecrã mostrava `fleetCash.statePending`
escrito a sério, ao utilizador. `tsc`, `eslint`, os 140 testes e o `vite build`
estavam **todos verdes** por cima disso, e o contador de cobertura dizia 100%
porque conta as chaves que existem — e o problema era não existirem.

**Guarda posta: `src/i18n/locales.test.ts`** (7 testes). Varre o `src` à procura
de `t("x.y")` e exige que cada chave exista. Verificado por mutação: apagar uma
chave ou encurtar o array dos dias faz o teste falhar mesmo.

- **pt/en/fr: estritos**, e com o mesmo conjunto de chaves.
- **Kriol: linha de base que só encolhe** (`kri-por-traduzir.json`, 330 chaves).
  Não se exige paridade — os ecrãs do Bornaal e os textos legais ficam de fora
  até haver revisão de falante nativo — mas **uma chave nova sem Kriol falha**.
- **`chaves-sem-ficheiro.json` (12 chaves): dívida registada, não resolvida.**
  São chaves que não existem em idioma NENHUM e vivem do valor por omissão em
  português passado no código — ou seja, aparecem em português a quem tem a app
  em inglês. Acrescentar a chave resolve-as, uma a uma.
- `profile.myOrders` foi corrigida (não tinha ambiguidade).
- **A ambiguidade do `driverDashboard` foi resolvida por decisão do dono
  (2026-09-21): duas chaves, não uma.** `goingToRestaurant`/`goingToCustomer`
  estavam a servir dois sítios com textos diferentes. Passaram a
  `onTheWayToRestaurant`/`onTheWayToCustomer` ("A caminho de…", o banner que
  descreve o ESTADO da entrega activa) e `goToRestaurant`/`goToCustomer`
  ("Ir a…", a etiqueta curta na lista de entregas). Os nomes antigos não existem
  mais em lado nenhum.

**Os dias da semana saíram do código para o i18n** e são indexados por
`weekday` (0 = domingo), que é o que o backend guarda — não pela ordem no ecrã.
Há um teste que exercita a instância real do i18next, porque se o
`returnObjects` falhasse `t` devolvia a string `"businessHours.days"` e cada dia
saía `undefined`, sem erro.

**9.5 — Kriol — CONCLUÍDA na parte que é DeliveryApp (2026-09-21).** 138 chaves
traduzidas; cobertura 895 → 1130 (**79%**). O que ficou de fora ficou por
critério, não por cansaço:

- **O critério é QUE ECRÃ usa a chave, não o nome do namespace.** Metade do
  namespace `businessDetail` só é usada pelo `BeautyDetail.tsx` — inclusive o
  formulário de avaliação que a 9.4 removeu do restaurante e que continua vivo na
  beleza. Traduzir por namespace metia 11 chaves de um ecrã excluído e deixava de
  fora `providerCardExtra.verifiedLabel`, que o `RestaurantCard` usa mesmo.
- **144 chaves de ecrãs Bornaal/beleza** (`providerDashboard`, `providerDetail`,
  `beautyEdit`, `BeautyDetail`, …) — bloco de limpeza do Bornaal, separado.
- **34 de Termos e Privacidade** — texto com valor legal, espera revisão nativa.
- **As que dizem "Bornaal" não se traduzem** (`aboutPage.title`,
  `installPrompt.androidTitle`, …). Traduzir o nome para Kriol cimentava numa
  língua a mais aquilo que o §45 manda remover. As irmãs sem marca
  (`installPrompt.install`, `later`, `iosShare`, …) foram traduzidas.
- **12 chaves não existem em idioma nenhum** (`chaves-sem-ficheiro.json`): não há
  o que traduzir enquanto a chave não for criada.

**O Kriol continua POR REVER por falante nativo** — a decisão da Fase 9 mantém-se
inteira. O que mudou é a quantidade, não o estatuto.

**Fica por fazer:** os ficheiros de Fases 3–5 que continuam com texto fixo
(`FleetDriverDetail`, `DeliveryPayload`, `OrderTotals` — de 2026-09-10, fora da
janela deste achado), as 190 chaves de Kriol dos blocos excluídos, e as 12 sem
ficheiro.

**Não relacionado, achado ao verificar os buckets:** o
`scripts/mover-para-privado.mjs` **já correu** (8 vozes e 4 comprovativos órfãos
movidos a 2026-09-20 10:43–10:44; zero referências no formato antigo em
`orders`). Sobravam **11 `.webm` no `portfolio` público** que estavam fora do
âmbito do script. Tratados a 2026-09-21 — ver a secção seguinte.

## Órfãos de voz e a voz de chat (2026-09-21, aprovado pelo dono)

`moverOrfaos` no `scripts/mover-para-privado.mjs` só conhecia comprovativos
(`<uid>/orders/payment/`). Passou a ser uma lista de tipos e trata também
`<uid>/orders/voice/` → `notas-voz`. **10 vozes órfãs movidas**, nunca apagadas
(§56): ficam no bucket privado sem referência, ao alcance do próprio e do admin.
`notas-voz` 9 → 19; `portfolio` 11 → 1 `.webm`.

Verificado por HTTP **sem chave nenhuma**: a URL pública antiga dá 400, o bucket
privado não serve por URL pública (400).

**O 11.º ficheiro NÃO foi movido, de propósito, e o script recusa-o em voz alta.**
`<uid>/chat/voice/…` não é órfão nem é nota de pedido: é uma mensagem de voz
viva, referenciada em `messages.content`, entre dois utilizadores reais. O bucket
`notas-voz` dá acesso pelo **PEDIDO** (`pode_ouvir_nota_voz`: cliente, dono do
restaurante, motorista atribuído, admin) — **não pela conversa**. Movê-la para lá
tirava-a a quem a recebeu, calada. Continua a abrir sem sessão (confirmado: 200),
e fechá-la precisa de bucket e policy próprios, com a conversa como critério.
**É decisão do dono, e é a última fuga conhecida no `portfolio`.**

**Armadilha para quem estender o script:** o filtro dos órfãos é o CAMINHO, não a
tabela — por definição não há linha que lhes aponte. Um padrão largo de mais
apanha ficheiros vivos de outra funcionalidade, e o dano só aparece quando
alguém tenta abrir o que já lá não está.

## Voz de localização do restaurante (2026-09-21, aprovado pelo dono)

O restaurante grava **uma vez**, no perfil, uma indicação falada de onde fica.
Essa gravação passa a valer em **todos** os pedidos dele, sem nada a gravar de
cada vez. No painel do motorista há então duas vozes num pedido de restaurante:
a do restaurante (onde recolher) e a do cliente (onde entregar), que já existia.

`profiles.location_voice_url`, ao lado do resto da configuração
(`accepting_orders`, `prep_time_minutes`, `orange_money_method`). Guarda o NOME
do objecto no bucket privado `notas-voz`, nunca uma URL — mesmo desenho das
outras vozes. Reutiliza o `VoiceRecorderField` da Fase 7.3 tal e qual.

**Decisões do dono:**

- **Sem gravação, o motorista não ouve nada dessa parte** — sem erro, sem
  bloquear o pedido. Mesmo default seguro do horário ("sem horário = sempre
  aberto"): há restaurantes reais em produção que nunca vão abrir este ecrã.
- **O motorista ouve enquanto a entrega estiver POR CONCLUIR**, e não para
  sempre. Mesma janela já usada para o telefone do motorista: o acesso dura
  enquanto durar o trabalho. Quem entregou há seis meses deixa de ouvir.
- **Partilha o slot "Onde recolher"** que a Fase 7.3 criou, em vez de um bloco
  novo. As duas fontes respondem à mesma pergunta e **nunca coexistem**: um
  envio tem `pickup_voice_note_url` e não tem restaurante; um pedido de
  restaurante é o contrário. Dois blocos davam ao motorista duas caixas para a
  mesma coisa, uma delas sempre vazia (§51).

**O que a auditoria revelou, e é o cerne desta funcionalidade:**

- **`pode_ouvir_nota_voz` não cobria isto.** Dava acesso por pasta própria,
  admin, ou **ligação a um pedido** — e uma voz de PERFIL não está ligada a
  pedido nenhum. O restaurante ouvia-a (pasta dele) e o motorista não. Foi
  preciso uma quarta via na policy, e só ela.
- **O caminho de escrita tinha de ser fechado no mesmo passo.** Com `UPDATE`
  directo em `profiles`, um restaurante punha na coluna o nome da nota de voz
  **de outro cliente** e, pela policy nova, os motoristas dele passavam a ouvir
  a morada falada de um estranho. É o mesmo buraco que o `create_order` fechou a
  2026-09-17. Por isso escreve-se só por `set_business_location_voice`, que
  chama `assert_nota_voz_do_proprio`.
- **A coluna é PRIVADA**: fora de `PUBLIC_PROFILE_COLUMNS` e sem GRANT. O dono
  lê-a por `get_my_profile_private`, o motorista por `get_my_deliveries`. A
  leitura directa da tabela dá 403 — testado, porque os dois caminhos falham de
  maneiras diferentes.
- **`get_my_deliveries` só devolve a voz enquanto a entrega está por concluir**,
  para bater certo com o que a policy deixa abrir. Devolver o nome depois de
  entregue dava ao painel uma referência que o Storage já recusa assinar: um
  leitor partido no ecrã em vez de nada, que é pior.

**Armadilha registada:** acrescentar uma coluna ao `RETURNS TABLE` de uma função
obriga a `DROP FUNCTION` — o `CREATE OR REPLACE` recusa — e **o `DROP` leva os
GRANTs consigo**. `get_my_profile_private` e `get_my_deliveries` ficariam
inacessíveis ao frontend sem o `GRANT` a seguir, com um 404 que parece bug de
frontend. Os GRANTs foram repostos e confirmados (`authenticated` +
`service_role`, nunca `anon`).

**Testado por HTTP real com JWT normal** (`scripts/voz-restaurante-test.mjs`, 18
assertivas, nunca `service_role`): o dono grava a sua e não a de outro negócio;
não aponta a coluna para a voz de outra pessoa; o anónimo não grava nem assina;
o motorista da entrega assina a voz do restaurante certo e **não a de outro**;
o cliente do pedido não a assina; regravar substitui e o ficheiro velho sai do
bucket; depois de concluída o motorista perde a voz e perde a assinatura.

**Uma assertiva é um CONTROLO, e não enfeite:** a recusa de assinar a voz de
outro restaurante devolve 400, que é também o que um ficheiro inexistente
devolveria. Sem provar que essa voz existe e é assinável pelo dono dela, aquela
assertiva passava com um caminho errado — verde pela razão errada.

**As farmácias da Fase 8 herdam isto de graça:** é uma coluna em `profiles`, e
uma farmácia é um `profile` como o restaurante.

**Achado lateral, corrigido aqui:** o `VoiceRecorderField` tinha texto fixo em
português ("Gravar indicação", "A guardar…", "Gravada"). Escapou à Fase 9.5
porque não estava na lista dos sete ficheiros. Entrou no i18n nos 4 idiomas.

## Checkout e contacto — decisões tomadas (2026-09-17)

Polimento pedido pelo dono ao rever os ecrãs reais: checkout em 4 pontos (1 →
nome/telefone pré-preenchidos, 2 → código de pagamento sempre visível, 3 →
código OU número, 4 → comprovativo obrigatório), mais o contacto directo abaixo.

**Ligar ao restaurante e ao motorista a partir do pedido.** A decisão sobre o
motorista foi tomada por mim, não pelo dono — fica aqui para ser confirmada.

- **Telefone do restaurante: sempre visível** no acompanhamento do pedido. Já é
  público (`profiles.phone`, decisão de 2026-09-09); não se abre nada novo.
- **Telefone do motorista: só enquanto ele está com o pedido** —
  `motorista_encontrado`, `pedido_recolhido`, `a_caminho`. Antes de aceitar não
  há motorista; depois de concluir, o cliente não precisa do número pessoal de
  quem entregou, e guardá-lo para sempre expunha o motorista sem razão.
- **Chega pela RPC `get_customer_orders`**, não por policy nova em `drivers`
  (que continua própria linha + admin). A RPC decide a janela; a tabela não abre.
- **Envio (Fase 7) não tem restaurante**: sem botão de ligar ao restaurante.

**Ponto 3 — o restaurante escolhe como recebe por Orange Money.** Pedido pelo
dono; o desenho é meu.

- **`profiles.orange_money_method`**: `'codigo'` (USSD, o cliente toca e paga),
  `'numero'` (o cliente copia e transfere) ou NULL (não recebe por Orange Money —
  só dinheiro na entrega). Os dois valores continuam guardados: trocar de método
  não obriga a reescrever o outro.
- **Quem decide o que o cliente vê é o servidor**: `get_business_payment_info`
  devolve só o do método escolhido. Um CHECK impede escolher um método sem o
  valor correspondente preenchido.
- **Migração:** restaurante com código fica em `'codigo'` (era o que o checkout já
  lhe mostrava); só com número fica em `'numero'`. Nenhum cliente vê diferença.
- **Privada**, como o código e o número: não entra no GRANT por coluna nem em
  `PUBLIC_PROFILE_COLUMNS`. O dono lê-a por `get_my_profile_private`.

**Ponto 4 — comprovativo obrigatório, e o servidor fecha o "pagar agora"**
(aprovado pelo dono, juntos por serem a mesma função). Imposto em `create_order`,
não só no ecrã (§46):

- **`online` só se o restaurante recebe por Orange Money** (`orange_money_method`
  não nulo). Antes, um JWT marcava "pago por Orange Money" num restaurante sem
  código nem número — o cliente não tinha para onde pagar, e o restaurante via um
  pedido "pago" que nunca recebeu.
- **`online` exige comprovativo, e o comprovativo tem de EXISTIR**: um objecto no
  bucket `portfolio`, na pasta `<auth.uid()>/orders/payment/`. Não basta texto no
  campo — um `"x"` passava. A pasta é a do próprio cliente (a policy de storage
  só deixa escrever lá), portanto não serve o comprovativo de outra pessoa.
  A escolha é minha: é a leitura fiel de "obrigatório", e não uma URL qualquer.
- **Pedido `entrega` não guarda comprovativo**, mesmo que o ecrã o envie.
- **Pedidos antigos não são tocados**: há 1 pedido online sem comprovativo em
  produção, de antes da regra. Fica como está (§56).
- **Os dois achados foram depois aprovados e corrigidos** — ver a secção seguinte.

**Comprovativos privados (2026-09-17, aprovado pelo dono).**

- **Bucket privado `comprovativos`**, separado de `portfolio` (que é público e
  continua a servir galeria, fotos e notas de voz). Caminho `<uid do cliente>/<ficheiro>`.
  `orders.payment_proof_url` passa a guardar o NOME do objecto, não uma URL: a
  imagem só se abre por URL assinado de 5 minutos (`createSignedUrl`), o mesmo
  padrão dos documentos de verificação.
- **Quem lê (policy SELECT, via `pode_ver_comprovativo`):** o cliente que o enviou,
  o dono do restaurante do pedido a que está ligado, e o admin. Mais ninguém — nem
  outro restaurante, nem o anónimo. O URL assinado, enquanto vive, abre para quem o
  tiver: é o limite do mecanismo, e por isso a vida é curta.
- **Apagar:** só o próprio cliente e só enquanto o comprovativo NÃO está ligado a
  nenhum pedido (policy DELETE, via `comprovativo_ligado_a_pedido`). Sem policy de
  UPDATE: ninguém substitui a imagem de um comprovativo já enviado.
- **Um comprovativo, um pedido:** índice único parcial em `orders.payment_proof_url`
  e verificação em `create_order`. Sem isto, a mesma captura pagava dois pedidos.
- **Nota que corrige uma suposição do pedido:** as notas de voz NÃO usavam URLs
  assinados — estão no `portfolio` público. Tal como o comprovativo de comissão
  (`commission_payments.proof_url`, §54). Ficam como estão até o dono decidir.
- **4 comprovativos antigos** de clientes reais continuam no `portfolio` público,
  sem nenhum pedido ligado. Não foram movidos nem apagados: movê-los exige a sessão
  do dono de cada ficheiro ou a chave de serviço, e apagá-los é decisão do dono (§56).

**Notas de voz e comprovativos de comissão privados (2026-09-17, aprovado pelo dono).**
Mesmo desenho dos comprovativos de pedido.

- **Buckets privados `notas-voz` e `comprovativos-comissao`.** As colunas
  (`orders.voice_note_url`, `orders.pickup_voice_note_url`,
  `commission_payments.proof_url`) guardam o NOME do objecto; ouve-se/vê-se por URL
  assinado de 5 minutos.
- **Quem ouve uma nota de voz (`pode_ouvir_nota_voz`):** o cliente do pedido, o dono
  do restaurante do pedido, o motorista ATRIBUÍDO (tem a entrega em `deliveries`) e o
  admin. Um motorista que ainda só vê a oferta não ouve — o painel dele também só
  mostra a voz depois de aceitar. A frota não ouve (não pediu, e `deliveries` já lhe
  está fechada por decisão de 2026-09-10).
- **Quem vê um comprovativo de comissão (`pode_ver_comprovativo_comissao`):** quem o
  enviou e o admin.
- **Apagar:** só o próprio, e só enquanto não está ligado a pedido / pagamento de
  comissão. Sem policy de UPDATE em nenhum dos dois.
- **Buraco fechado, que vinha com o desenho:** `create_order` e `create_send_order`
  gravavam o endereço da voz sem validar nada. Como o acesso passa a depender do
  pedido, um cliente que pusesse no seu pedido o nome da nota de voz de OUTRO
  cliente dava ao seu restaurante e ao seu motorista acesso à morada falada de outra
  pessoa. Agora a voz tem de existir e ser da pasta do próprio cliente
  (`assert_nota_voz_do_proprio`). O mesmo para o comprovativo de comissão, por
  trigger em `commission_payments`.
- **Transição, não permanente:** a validação da voz aceita também o formato antigo
  (URL pública do `portfolio`) desde que o ficheiro exista e seja da pasta do
  próprio cliente. Existe para a janela entre a migração e o deploy do frontend, e
  para bundles antigos em cache. Pode sair quando não houver pedidos novos com esse
  formato.
- **Ficheiros existentes:** as vozes antigas continuam a tocar pela URL pública até
  o script `scripts/mover-para-privado.mjs` as mover e reescrever as referências nos
  pedidos. O frontend aceita os dois formatos.

**Estado a 2026-09-20 (o que foi mesmo feito).**

- **Publicado.** O trabalho dos buckets privados esteve 3 dias na base de dados sem
  o frontend correspondente estar em produção, e nessa janela **dois pedidos reais
  gravaram voz no `portfolio` público** — o fallback do formato antigo a ser usado a
  sério. Commit `f4f9884`, deploy de produção confirmado. **Lição: uma migração que
  fecha um bucket e o frontend que escreve nele têm de ir juntos; separá-los não
  adia a proteção, mantém a fuga aberta com ar de resolvida.**
- **Verificado em produção** por HTTP com JWT normal (nunca `service_role`): o
  anónimo não abre a voz privada, o bucket não serve por URL pública, outro cliente
  não a assina, o dono assina e ouve. E, por contraste, uma voz antiga do
  `portfolio` **abre sem sessão nenhuma** — a fuga que o script vai fechar.
- **`scripts/mover-para-privado.mjs` escrito** (não existia; o parágrafo acima
  afirmava que sim). Simula por omissão; `--executar` move. Move as **8 referências
  de voz** e as **4 imagens órfãs** de comprovativo. Preserva o caminho `<uid>/...`
  tal e qual — as policies comparam a 1.ª pasta com `auth.uid()`, e um caminho novo
  tirava o ficheiro ao dono. A base de dados é reescrita ANTES de o original ser
  apagado, e os órfãos são revalidados no momento de mover. **Por correr: precisa da
  chave de serviço, que só o dono tem.**
- **Órfãos: movidos, nunca apagados** (§56). São de clientes reais. Ficam no bucket
  privado sem referência, ao alcance do próprio cliente e do admin.
- **`commission_payments` não tem nada por mover** — o único comprovativo já estava
  no formato novo. O script trata o caso na mesma, para quando houver.
- **Resíduo de teste limpo.** A corrida `rlstest-1789659458199` (2026-09-17) ficou
  por limpar: 9 contas, 2 pedidos, 2 entregas, 1 pagamento de comissão, 1 frota e 8
  ficheiros nos buckets privados. **`ledger_entries` = 0** — o teste nunca concluiu
  um pedido, e o ledger real (19 lançamentos) não foi tocado. Apagado com
  salvaguardas que abortavam se houvesse ledger, pedido de cliente real ou motorista
  real pelo meio.
- **Armadilha registada:** `DELETE FROM storage.objects` por SQL é **recusado**
  (`storage.protect_delete`), mesmo com a chave de serviço. Os ficheiros saem pela
  Storage API. E a policy de DELETE só deixa apagar o que **não** está ligado a
  pedido/pagamento — portanto a ordem é: apagar as linhas primeiro, o que desliga os
  ficheiros, depois os ficheiros, e só no fim as contas.

---

# Fase 1 — Fundação — CONCLUÍDA (2026-09-09)

Aprovada e executada. Não avançar para a Fase 2 sem aprovação explícita do
checklist.

- [x] Autorização em `update_order_status` — dono do restaurante, motorista da
      entrega, cliente (só cancelar em `novo`) e admin. Antes: qualquer
      autenticado mudava o estado de qualquer pedido
- [x] Disciplina de transições (§36) — matriz imposta no servidor, admin com
      válvula de correcção registada no histórico
- [x] `driver` acrescentado ao enum `app_role`
- [x] RLS de `drivers` — era `USING (true)` para o papel público; passa a
      própria linha + admin, e o anónimo perde a tabela
- [x] REVOKE do `anon` em 23 RPCs `SECURITY DEFINER`. Ficam 3 de propósito:
      `has_role` (avaliada dentro de policies), `increment_provider_view` e
      `record_provider_contact` (rota pública `/loja/:id`)
- [x] `profiles` fechado a anónimos — 22 colunas públicas; fora do alcance:
      `merchant_code`, `payment_number`, `verification_doc_url`,
      `verification_selfie_url`, `verification_reason`. `phone`, `lat` e `lng`
      ficam públicos por decisão do dono
- [x] `profiles` — anónimo perde também INSERT/UPDATE/DELETE
- [x] `messages` fechado a anónimos — escrevia para qualquer `receiver_id` e
      qualquer pessoa lia o que tivesse `sender_id IS NULL`
- [x] Policies duplicadas removidas — 2 em `profiles`, 3 em `notifications`
- [x] `entregue` fundido em `concluido` (15 pedidos)
- [x] `complete_delivery` deixa de reintroduzir `entregue`
- [x] Cartão "Motorista" removido do ecrã de login e do link `?mode=motorista`
      (Aditamento 1.3). O fluxo do motorista fica intacto (Aditamento 1.4)
- [x] Teste automatizado da disciplina de estados, com peso nos casos
      negativos — `src/lib/orderTransitions.test.ts`, 16 testes

## Por fechar da Fase 1 — nada. Fechada em 2026-09-10
- [x] `alfa` — a quarta conta de motorista foi apagada, pela ordem das chaves
      estrangeiras, na migração `20260909222100_fase1_remove_alfa_driver_account`
      (commit `ed7d61f`). As 9 entregas e o comprovativo **não** foram apagados:
      as referências de auditoria ficaram a NULL e as linhas mantiveram-se, por
      §56 (nunca apagar silenciosamente histórico financeiro)

## Achado durante a Fase 1, fora do âmbito
- `anon` tem INSERT/UPDATE/DELETE nas 32 tabelas (postura por omissão do
  Supabase; o RLS é o portão). Só `profiles` e `messages` foram fechados.
  Rever as outras exige decidir tabela a tabela quais escritas anónimas são
  intencionais — `complaints` e `service_requests` têm policies de INSERT para
  `anon` de propósito. **`reviews` já não:** a Fase 9.4 (2026-09-20) removeu-lhe
  a de INSERT anónimo por decisão do dono, também para a beleza
- `merchant_code`, `payment_number` e as colunas de KYC continuam legíveis por
  qualquer autenticado. Apertar isso exige movê-las para RPC com verificação
  de dono

## Adiado, não bloqueava a Fase 1
- Rotação da chave anon JWT (planear por causa dos triggers de push)
- Remoção do código órfão (~2900 linhas) e das 11 tabelas vazias — fase de
  limpeza do Bornaal
- Refactor de AdminDashboard.tsx (1464 linhas) e BusinessDetail.tsx (1143)
- Kriol a 63% (748/1182 chaves)
- ~~18 erros de `tsc --noEmit` pré-existentes~~ — resolvidos na Fase 9.1 e no
  que se lhe seguiu. A 2026-09-20 `tsc --noEmit` dá 0 erros
