# AUDITORIA FASE 0 — DELIVERYAPP

**Data:** 2026-09-09 · **Commit auditado:** `37c193c` · **Supabase:** `meafyvhedhhxbjcyzblw`
**Método:** leitura estática do código + consulta directa à base de dados de produção. Nenhum código alterado.
**Medido contra:** documento mestre (88 secções) + Aditamentos 1 e 2, gravados em `CLAUDE.md` (commit `83a9cdd`).

Classificação conforme §87: 🟢 PRESERVAR · 🟡 MODIFICAR · 🔴 RECONSTRUIR · ⚫ REMOVER

---

## 0. RESUMO EXECUTIVO

O DeliveryApp tem um fluxo de entrega restaurante→motorista→cliente que funciona
ponta-a-ponta e tem dados reais em produção (24 pedidos, 10 entregas, 7
concluídas). Isso é a base do §57 fluxo (1), e é preservável.

O que falta não são detalhes: **três dos pilares do documento mestre não existem
em nenhuma forma no código** — frotas (§11-12), preço de entrega por bairro
(§13-15) e o ledger financeiro (§30, §53). E a comissão só existe do lado do
restaurante, não da frota (§26).

Além disso, a auditoria encontrou uma falha de autorização crítica em produção
(`update_order_status`) e três exposições de dados a utilizador anónimo.

**Contradições encontradas entre o documento e a realidade do código estão
listadas na secção 9. São o item mais importante deste relatório.**

---

## 1. ARQUITECTURA E STACK

| Camada | O quê | Estado |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript, ~20 600 linhas | 🟢 |
| UI | Tailwind + shadcn/ui (49 componentes `ui/`) | 🟢 |
| Estado servidor | TanStack Query | 🟢 |
| Rotas | react-router-dom, 22 rotas activas, todas lazy | 🟢 |
| Backend | Supabase (Postgres + RLS + RPC + Realtime + Storage) | 🟢 |
| Mapas | Leaflet/OpenStreetMap — presente mas **não renderizado** (§21) | 🟢 |
| i18n | pt / en / fr / kri | 🟡 |
| Testes | 11 ficheiros vitest, 86 testes, todos a passar | 🟡 |
| Build | `vite build` OK em 39s | 🟢 |
| Deploy | Vercel, auto a partir de `main`. Produção sincronizada | 🟢 |

**Ficheiros grandes** (§ nenhum, mas afecta manutenção): `AdminDashboard.tsx` 1464
linhas, `BusinessDetail.tsx` 1143, `BusinessEdit.tsx` 726, `DriverDashboard.tsx` 702. 🟡

---

## 2. BASE DE DADOS

**34 tabelas, RLS activo em todas as 34.** Nenhum advisor de nível ERROR.

### Tabelas do produto actual (usar e manter)
`profiles`, `orders`, `order_status_history`, `menu_categories`, `menu_items`,
`business_categories`, `drivers`, `deliveries`, `delivery_proofs`,
`delivery_tracking`, `notifications`, `push_subscriptions`, `messages`,
`user_roles`, `bairros`, `platform_settings`, `commission_payments`. 🟢/🟡

### Tabelas das verticais removidas do Bornaal — 0 linhas ⚫
`service_requests`, `reviews`, `portfolio_images`, `proposals`, `request_bids`,
`complaints`, `quality_levels`, `beauty_categories` (10 categorias semeadas),
`beauty_items`, `appointments`, `appointment_status_history`.

### Dados vestigiais 🟡
- `profiles.profile_type`: **12 de 14 perfis são `provider`**, só 2 são `business`.
- `user_roles`: 4 papéis `business` — mais papéis do que perfis de restaurante.
- `categories`: 1 linha, "Serviços Digitais".
- `app_role` enum: `client, provider, admin, business, beleza` — **sem `driver`**.

### Estados de pedido em produção
`concluido` x11, `cancelado` x4, `entregue` x4, `pedido_recolhido` x2,
`em_preparacao` x1, `novo` x1, `confirmado` x1.
Decisão do dono (2026-09-09): `entregue` é lixo herdado, funde em `concluido`.

---

## 3. SEGURANÇA E RLS (§46, §47)

### 🔴 Falhas confirmadas em produção

**3.1 `update_order_status` — sem qualquer autorização.** A função é
`SECURITY DEFINER`, 5072 caracteres. O `anon` já foi revogado (`20260907085642`
funcionou nessa parte), mas **qualquer utilizador autenticado** pode executá-la.
O único `auth.uid()` do corpo está na posição 2868 e serve para preencher
`created_by` no histórico — não é um portão. Zero `RAISE EXCEPTION` de
autorização. A variável `v_owner` é declarada e nunca usada.
Além disso **não há validação de transição**: a função valida que o valor do
estado está numa lista de 13 nomes, mas nunca lê o estado actual do pedido.
Um salto `novo` → `entregue` é aceite.
Viola §36, §46, §71, §72. Qualquer das 10 contas de cliente pode cancelar
pedidos de qualquer restaurante ou marcá-los como entregues.

**3.2 `profiles` — anónimo lê todas as colunas.** Policy
`Profiles are viewable by everyone` com `USING (true)` para o papel público, e o
GRANT de SELECT cobre coluna a coluna: `phone`, `merchant_code`,
`payment_number`, `lat`, `lng`, `verification_doc_url`,
`verification_selfie_url`.
A migração `20260908224136` que fechou "telefone a anon" tratou de
`service_requests.requester_phone` — nunca tocou em `profiles`.
**Decisão do dono: `phone` fica público de propósito.** As restantes colunas não.

**3.3 `drivers` — anónimo lê `phone`, `current_lat`, `current_lng`.** Policy
`Drivers viewable by all` com `USING (true)`. É seguimento da localização em
tempo real de qualquer motorista, sem sessão.

**3.4 `messages` — anónimo escreve e lê.** O `WITH CHECK` de
`Anyone can send messages` é
`(auth.uid() = sender_id) OR (sender_id IS NULL) OR (auth.uid() IS NULL)`:
anónimo insere mensagem para qualquer `receiver_id`. E
`Users can view own messages` inclui `OR (sender_id IS NULL)` — qualquer pessoa
lê todas as mensagens anónimas.

### 🟡 A corrigir, risco menor

- **Policies duplicadas que se anulam.** `profiles` tem
  `Providers can update own profile` (WITH CHECK restrito, bloqueia
  auto-verificação) e `Providers update own profile` (WITH CHECK só
  `auth.uid() = user_id`). Policies permissivas combinam com **OR** — a segunda
  anula a primeira. A defesa real é o trigger `trg_protect_profile_verification`,
  que está activo. `notifications` tem 4 pares redundantes de 8 policies.
- **48 funções `SECURITY DEFINER` com EXECUTE para `anon`** (cerca de metade são
  de trigger). Todas as chamáveis têm guarda interna — verificadas 12. Risco
  efectivo baixo, mas contradiz o objectivo declarado de `20260907085642`.
- **`platform_settings` legível por todos os autenticados**, incluindo
  `platform_merchant_code=#144#32*213486#`.
- **Chave anon JWT em texto** em 4 migrações versionadas no repositório público
  (`20260820100000`, `20260826110000`, `20260906000007`, e a do vault). Não é
  segredo por desenho (§49), mas prende a chave: rodá-la parte os triggers de push.

### 🟢 Bem desenhado
`deliveries`, `delivery_proofs`, `delivery_tracking`, `order_status_history` e
`appointments` têm **só** policy de SELECT. Nenhuma escrita directa é possível;
tudo passa por RPC com verificação de dono. É negação por omissão, conforme §46.

---

## 4. AUTENTICAÇÃO (§8, §48)

Três modelos coexistem:

| Perfil | Mecanismo | Estado |
|---|---|---|
| Cliente | Telefone + PIN 4 dígitos derivado (`src/lib/clientAuth.ts`) | 🟢 §8 cumprido |
| Restaurante / Motorista / Admin | Email + password, mínimo 8 + HIBP no browser | 🟢 |
| — | Verificação nativa de fugas do Supabase | 🟡 exclusiva do plano Pro, adiada |

`clientAuth.ts` documenta explicitamente que SALT, formato e normalização de
telefone são contrato — mudá-los tranca todos os clientes. Alinhado com §48.
Limitação assumida: PIN de 4 dígitos = 10 000 combinações.

Guardas de rota: `RequireRole`, `RequireAdmin`, `RequireClientArea`
(28 testes). A navegação pública para contas de negócio está implementada
exactamente como §9 exige. 🟢

---

## 5. MOTORISTAS E FROTAS (§11, §12, Aditamento 1)

### 5.1 Frotas: NÃO EXISTEM ⚫→construir

`grep -i "fleet\|frota"` em `src/` e `supabase/migrations/` devolve **zero**
resultados. Não há tabela `fleets`, não há coluna `fleet_id` em `drivers`, não
há painel de frota, não há associação motorista→frota, não há preços por
bairro definidos por frota. §11, §12, §13, §32 são construção de raiz — Fase 3.

### 5.2 Registo de motorista individual: EXISTE 🔴 reverter (Aditamento 1)

**Reversão deliberada, não esquecimento.** Mapeamento do que existe:

| Peça | Localização |
|---|---|
| Cartão "Motorista" no ecrã de escolha | `src/pages/Login.tsx:314-321` |
| Modo de autenticação `driver` | `Login.tsx:30, 40, 198, 239, 340, 474` |
| Chamada de auto-registo | `src/hooks/useDrivers.ts:65` → RPC `register_as_driver` |
| RPC | `register_as_driver(p_name, p_phone, p_vehicle_type)` |
| Painel | `src/pages/DriverDashboard.tsx` (702 linhas), rota `/painel-motorista` |
| Prioridade no redirect pós-login | `src/lib/getPostLoginDestination.ts` (driver > business > cliente) |

Conforme Aditamento 1.3, o **cartão de registo independente** sai da interface.
Conforme Aditamento 1.4, o **fluxo do motorista** (`DriverDashboard`, aceitar /
recolher / entregar) **fica** — passa a ser acedido por conta criada por uma
frota. A arquitectura de frota deve reutilizar este código, não duplicá-lo. 🟢

### 5.3 As 4 contas de motorista existentes (Aditamento 1.2)

Não há coluna `fleet_id`, portanto **as quatro são legado por definição**.

| Nome | Telefone | Entregas | Concluídas | Provas | Papéis |
|---|---|---|---|---|---|
| `alfa` | 957107795 | **9** | **7** | **1** | client, **admin** |
| `Alfa Balde` | 967104489 | 0 | 0 | 0 | client |
| `Test2` | 955123457 | 0 | 0 | 0 | client |
| `Motorista D` | 955000001 | 0 | 0 | 0 | **nenhum** |

**`alfa` não é uma conta de teste descartável.** Carrega 9 das 10 entregas do
sistema, incluindo as 7 concluídas e a única prova de entrega — é a evidência
de que o fluxo funciona — e é uma das duas contas **admin** da plataforma.
Apagá-la viola §19, §56 e o Aditamento 1.2.
`Motorista D` é linha órfã: sem papel, sem `bornaal_id`, sem entregas.

---

## 6. PEDIDOS, DISPATCH E ENTREGA (§18, §34, §36, §37)

### 🟢 Funciona
Fluxo completo confirmado com dados reais: cliente encomenda (GPS silencioso +
nota de voz) → restaurante confirma → marca "pronto" → `create_delivery`
automática → motorista aceita → recolhe → valida código de 6 dígitos → entregue.
Prova de entrega por código + fotografia (§37) implementada.
Voz em vez de mapa (§21) implementada e é decisão de produto fechada.

### 🔴 Divergências do documento
- **Dispatch é broadcast, não por frota** (§34). `update_order_status` notifica
  `FROM drivers WHERE is_available = true` — todos os motoristas disponíveis da
  plataforma. Não há selecção de frota, nem registo de qual frota recebeu.
- **Estado sem autorização nem validação de transição** — ver 3.1.
- **Categoria "Entregas" de documentos/objectos não existe** (§4, §19).
  `orders.business_id` é `NOT NULL` e `useOrders.ts:10` tipa-o como obrigatório:
  hoje é impossível criar um pedido que não parta de um estabelecimento.
- **Preço de entrega não é apresentado ao cliente antes de confirmar** (§14, §83).
  `deliveries.delivery_fee` existe como coluna e nada a escreve.

---

## 7. FINANCEIRO (§24-§31, §53-§56, §84)

### 🔴 O modelo actual é incompatível com o documento

| Exigência | Estado actual |
|---|---|
| §30 ledger de eventos, saldo derivado | **Não existe.** `commission_payments` é tabela plana (0 linhas, nunca usada) |
| §24/§26 comissão sobre restaurantes **e** frotas | Só restaurantes (`commission_payments.business_id`) |
| §26 duas contas separadas | Uma só |
| §84 cada dívida rastreável até às transacções | `get_all_commissions` **calcula ao voo** a partir de `platform_settings.commission_rate` |
| §28/§29 dinheiro na entrega contabilizado por parte | Não existe repartição |
| §32 painel da frota | Não existe |

Consequência concreta do cálculo ao voo: mudar `commission_rate` de 5 para 6
reescreve retroactivamente toda a dívida histórica de todos os restaurantes.
Viola §30 e §84 directamente. Fase 6.

### 🟢 Alinhado
Sem gateway bancário; Orange Money + comprovativo + validação manual do admin
(§22, §23). `platform_settings` guarda `commission_rate=5` configurável pelo
admin (§24). `profiles.merchant_code` e `payment_number` existem (§23).

---

## 8. NOTIFICAÇÕES, AMBIENTE, BORNAAL, i18n

**Notificações (§35)** 🟢/🟡 — in-app + push com VAPID, edge function
`push-send` versionada no repositório, triggers para novo pedido, mudança de
estado e nova entrega. Estado verdadeiro vive no backend, conforme §35 e §71.
🟡 chave anon em texto nas migrações.

**Ambiente (§49)** 🟢 — `.env` fora do git (`.gitignore:16-18`), só
`.env.example` versionado, sem service_role no frontend, edge function lê tudo
de `Deno.env`.

**Bornaal (§45)** 🟡 — 30 ficheiros, ~200 ocorrências. Distinguir:
- Cosmético (fácil): `index.html` (11), i18n pt/en/fr (26 cada), `manifest.json`,
  `sw.js`, `Login.tsx`, `Landing.tsx`, `About.tsx`, `README.md` que ainda
  descreve um marketplace de serviços.
- **Estrutural (migração):** `bornaal_id` é coluna real em `profiles` e
  `drivers`, com identificadores já emitidos em produção (`BAAL-C77E-EB71`…).
  Renomear é migração de dados, não substituição de texto.

**i18n (§9 Fase 9)** 🟡 — pt/en/fr em paridade perfeita (1182 chaves cada).
Kriol com 748 — **faltam 434 (37%)**.

---

## 9. CONTRADIÇÕES ENTRE O DOCUMENTO E A REALIDADE — requerem decisão

**9.1 O Aditamento 2 afirma que a disciplina de estados "já está implementada e
testada por um teste E2E automatizado". Nenhuma das duas metades se confirma.**
- *Testada:* não existe teste E2E de estados. Os 5 ficheiros `test-*.cjs` da raiz
  são da era Bornaal (beleza, explorar, preview de imagem, perfil de beleza).
  Playwright está instalado mas não há teste de pedidos. Os 86 testes vitest são
  unitários (Login, RequireClientArea, Pagination, libs).
- *Implementada:* `update_order_status` valida o **valor** do estado contra uma
  lista, mas não valida a **transição** nem verifica quem chama. Ver 3.1.

**9.2 Apagar as 4 contas de motorista colide com o Aditamento 1.2 e com §19.**
Foi aprovado apagar as quatro; o Aditamento diz para não as apagar por causa
desta mudança e para propor tratamento. E `alfa` carrega 9 entregas, 7
concluídas, a única prova de entrega, e é admin. Ver 5.3.

**9.3 A remoção do cartão "Motorista" (Aditamento 1.3) não está no âmbito
aprovado da Fase 1.** É uma alteração de interface ligada ao modelo de frota
(Fase 3), mas deixá-la activa mantém aberto um caminho que o documento fechou.

---

## 10. PROPOSTA DE TRATAMENTO POR FASE

| Fase (§59-69) | O que a auditoria mandou para lá |
|---|---|
| **1 Fundação** | 3.1 autorização + transições · 3.2/3.3/3.4 RLS · policies duplicadas · REVOKE anon · `driver` no enum · fundir `entregue` |
| **2 Restaurantes** | Já existe em grande parte. Falta stock/`available`, horários, galeria |
| **3 Frotas** | Construir de raiz: `fleets`, `fleet_id`, painel, preços por bairro (§13-15), métricas (§39-40) |
| **4 Motoristas** | Reaproveitar `DriverDashboard`; ligar conta a frota; remover auto-registo |
| **5 Dispatch** | Substituir broadcast por selecção de frota; registar quem recebeu (§34) |
| **6 Financeiro** | Ledger (§30); comissão de frota (§26); contas separadas; painel de frota (§32) |
| **7 Entregas** | Pedido sem `business_id`; origem/destino; preço da frota (§19) |
| **8 Farmácias** | Extensão de `business_categories` + menu existente (Aditamento 2) |
| **9 Polimento** | Kriol 434 chaves; eslint; ficheiros grandes; branding Bornaal cosmético |
| **10 Evolução** | Motorista individual (reintroduzir), preço por km, mototáxi/táxi |
| **Sem fase** | Rotação da chave anon; remoção do código órfão e tabelas vazias; `bornaal_id` |
