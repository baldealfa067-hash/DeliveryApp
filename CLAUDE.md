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
