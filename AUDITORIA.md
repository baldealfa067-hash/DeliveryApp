# AUDITORIA — Bornaal / Bornaal
**Data:** 2026-08-21 · **Âmbito:** projeto completo `remix-of-remix-of-n-tarbadja-connect` + `*.sql` raiz + `supabase/migrations/*` · **Método:** leitura estática de código, sem execução de correções

> NOTA: Esta auditoria NÃO corrigiu nada — apenas reporta. Todas as referências incluem `ficheiro:linha` para navegação direta.

---

## Índice
1. [FUNCIONALIDADES](#1-funcionalidades)
2. [BUGS](#2-bugs)
3. [SEGURANÇA](#3-segurança)
4. [ESTRUTURA / CÓDIGO](#4-estruturacódigo)
5. [PRIORIDADES ORDENADAS](#5-prioridades-ordenadas-crítico--importante--pode-esperar)

---

## 1. FUNCIONALIDADES

Legenda: **CONCLUÍDA** = fluxo utilizador + BD + admin + realtime OK · **PARCIAL** = funciona no caminho feliz mas falha em edge cases / falta peça · **QUEBRADA** = erro bloqueante · **NÃO EXISTE** = sem código

| # | Funcionalidade | Estado | Resumo do que falta |
|---|----------------|--------|---------------------|
| 1.1 | Cadastro | **PARCIAL** | Race condition se confirmação de email ativa; sem validação forte; role atribuída só se `session` existir |
| 1.2 | Login / Sessão / Recuperação | **PARCIAL** | Login OK; recuperação existe mas sem rate-limit/captcha; sem reenvio confirmação |
| 1.3 | Verificação de prestador (KYC) | **CONCLUÍDA** | Fluxo completo prestador → admin → selo; doc+selfie em bucket privado |
| 1.4 | Avaliações | **PARCIAL** | Dois fluxos contraditórios (direto vs via pedido); spam ilimitado em diretas |
| 1.5 | Contacto / WhatsApp | **CONCLUÍDA** | `wa.me` + `tel:` + tracking via RPC em 4 locais |
| 1.6 | Notificações (in-app + push) | **PARCIAL** | In-app OK; push depende de Edge Function não versionada + anon key hard-coded no Postgres |
| 1.7 | Restaurantes / Lojas (business) | **CONCLUÍDA** | MVP sem pagamentos (por desenho); sem stock/horário/galeria |
| 1.8 | Painel Admin | **CONCLUÍDA** | Módulo mais completo; 11 queries paralelas + realtime 11 tabelas |
| 1.9 | Denúncias / Complaints | **PARCIAL** | Funciona mas anon pode spammar; sem feedback ao denunciante |
| 1.10 | Favoritos | **NÃO EXISTE** | Zero código (`grep favorites` = 0) |
| 1.11 | PWA | **PARCIAL** | Instalável + push; sem offline/cache útil |

### 1.1 Cadastro — PARCIAL
**Existe:**
- UI `src/pages/Login.tsx:116-168` com `Tabs` login/signup e selector `ProfileType` (`provider|business` com ícones `Wrench`/`Store`, campos `name/email/password`).
- `supabase.auth.signUp` em `Login.tsx:56-60` com `emailRedirectTo: window.location.origin + "/painel"` e `data:{name}`.
- Atribuição de role pós-signup `Login.tsx:66-70`: `if(data.session) await supabase.rpc(register_as_business|provider)`. RPCs em `supabase/migrations/202606...sql` e `20260820000100_register_as_business.sql:7`.
- `useAuth.ts:32-35` lê `user_roles` para `isProvider/isBusiness`.

**Falta / quebra:**
1. **Race condition confirmação email.** `Login.tsx:66` só executa RPC se `data.session` existir. Se Supabase tiver `Confirm email = ON` (default), `session===null` e role nunca é criada. Utilizador fica sem role, bloqueado em `Profile.tsx:53-56` e `App.tsx:36-39` (redirect para `/inicio` sem perfil). Trigger `auto_create_profile` (`20260818010000_auto_create_profile.sql`) não cria role — não há fallback.
2. Sem força de password além de `password.length<6` (`Login.tsx:53`) e sem confirmação de password.
3. `emailRedirectTo` sempre `/painel` mesmo quando `business` deveria ir `/painel-loja`.
4. Erro `roleErr` só `console.error` (`Login.tsx:70`), sem toast para utilizador.
5. Sem rollback se `insert profiles` falhar após `auth.users` criado → perfil órfão (mitigado depois por `admin_delete_user` mas não no signup).

### 1.2 Login / Sessão — PARCIAL
**Existe:** `Login.tsx:42-49` `signInWithPassword`, `useAuth.ts:13-30` `onAuthStateChange`+`getSession`, `signOut` (`useAuth.ts:41-43`, `Profile.tsx:88-92`, `ProviderDashboard.tsx:227`), rotas `App.tsx:61-63` `/login|/esqueci-senha|/redefinir-senha`, páginas `ForgotPassword.tsx` + `ResetPassword.tsx`, redirect pós-login `Login.tsx:33-40` (admin→`/admin`, provider→`/painel`, business→`/painel-loja`).
**Falta:** sem OAuth/telefone; sem rate-limit/captcha no login (depende só do Supabase Auth default); sem reenvio de confirmação; lógica de auth duplicada `Profile.tsx:43-68` vs `ProviderDashboard.tsx:81-104` em vez de `useMyProvider`.

### 1.3 Verificação de prestador — CONCLUÍDA
**Evidência:** schema `20260816180000_add_provider_verification.sql:4-33` (`verification_status none|pendente|aprovado|rejeitado` + doc/selfie URLs), bucket privado `verification` + policies, RLS anti auto-verificação (`sql:39-47`), UI prestador `ProviderDashboard.tsx:58-64,150-179` upload + `update profiles pendente`, business idem `BusinessEdit.tsx:84-90,172-201`, admin `AdminDashboard.tsx:269-298` `approveVerification/rejectVerification` + `createSignedUrl`, visualização `ProviderDetail.tsx:179-181` `BadgeCheck`, `ProviderCard.tsx:68-73`, lib `verification.ts:38-42` `canSubmitVerification`. **Falta menor:** sem preview antes de enviar, sem apagar/reenviar antes de análise; `toggleVerified` (`AdminDashboard.tsx:259-267`) bypassa audit trail (toggle manual `is_verified` sem `pendente`).

### 1.4 Avaliações — PARCIAL (conceito quebrado)
**Dois fluxos:**
- **Direto** `ProviderDetail.tsx:100-134` e `BusinessDetail.tsx:191-224` (`rating+reviewerName+comment` → `insert reviews {provider_id,rating,comment,reviewer_name,user_id,request_id:null}`).
- **Via pedido** `Requests.tsx:88-92,228-256,798-806` + `useRequests.ts:179-204` `useSubmitReview` com `request_id` obrigatório após `mark_request_completed`.
- Schema `202603...sql:66` (`reviews`) + `20260817040000_review_after_completion.sql:13-26` exigia `request_id NOT NULL` + trigger `validate_review_insert` (`concluido`+`bid aceite`) — **bloqueava diretas**.
- Correção `20260822000000_fix_reviews_direct.sql:17-64` relaxa RLS para `auth.uid()=user_id` permitindo `request_id NULL` e trigger permite diretas — resolve mas deixa dois fluxos com regras diferentes.
- Leitura filtra `status='aprovado'` (`useProviders.ts:72-77`, `BusinessDetail.tsx:81`), admin `AdminDashboard.tsx:300-305` `approveReview/reject`.

**Quebra específica:**
1. **Spam ilimitado em diretas.** `UNIQUE (request_id,provider_id) WHERE request_id NOT NULL` (`20260817040000:13`) não cobre `request_id NULL`; mesmo `user_id` pode inserir infinitas 5★ diretas (`20260822000000:79-83` comenta isso).
2. Moderação inconsistente: diretas entram `pendente`, só aparecem se `aprovado`, mas autor vê `toast.success("reviewSent")` (`ProviderDetail.tsx:128`) como sucesso imediato — sem UI "a aguardar aprovação".
3. Média `avgRating` conta ambos os tipos mas `quality_levels` usa `reviews >=4` sem distinguir.
4. `BusinessDetail.tsx:223` só invalida `["provider",id]`, não `["providers"]` (diferente de `ProviderDetail.tsx:132-133`).
5. `useProposals.ts` é código morto (nenhum import).

### 1.5 Contacto / WhatsApp — CONCLUÍDA
`ProviderCard.tsx:35-43` (`whatsappBusinessMsg` vs `whatsappProviderMsg`), `ProviderDetail.tsx:74-90,264,270`, `BusinessDetail.tsx:115-131,413,419`, `Requests.tsx:195-199,598-605`; tracking `rpc record_provider_contact` e `increment_provider_view` (`ProviderDetail.tsx:54-57`, `BusinessDetail.tsx:72`), stats UI `ProviderDashboard.tsx:65,473-504`, `BusinessDashboard.tsx:46,181-209`. **Falta menor:** `cleanPhone` não normaliza DDI `+245`; `type="text"` livre em `ProviderDashboard.tsx:287` sem máscara/validação; sem fallback se WhatsApp não instalado.

### 1.6 Notificações — PARCIAL
**In-app CONCLUÍDA:** `notifications` (`types.ts:192-235`), `useNotifications.ts:17-50` (`useNotifications`, `useUnreadCount refetchInterval 10000`), `useNotificationsRealtime 52-79` (`postgres_changes user_id=eq.xxx`), `NotificationBell.tsx:19-94` (popover, badge, `markAllAsRead` ao abrir `27-32`), triggers: `notify_owner_on_bid` (`20260817050000`), `notify_owner_on_bid_status` (`20260819000000:7-54`), `notify_verified_providers` (`20260823000000`), `complaints_review_flow` (`20260819010000:75-104` corrigido `20260819030000:15-46`), `record_business_order` (`20260820010000:100-110`). **Push PARCIAL:** `20260820100000_push_notifications.sql` (`push_subscriptions`, `upsert_push_subscription`, triggers `push_after_notification`/`push_nearby_novidade` com `net.http_post` para `pfvuqehchkamhgjlugqn.supabase.co/functions/v1/push-send` com anon key hard-coded `sql:86,120`), `push.ts:4-151`, `usePushSettings.ts:29-125`, `Profile.tsx:225-273`, `PushPrompt.tsx`, `PushRepair.tsx`, `App.tsx:52-54`. **Quebras:** `markAllAsRead` automático apaga não lidas ao abrir; push depende de edge function não versionada no repo; anon key rotacionável; `push_nearby_novidade` dispara em todo `INSERT profiles` sem filtrar `profile_type`; Realtime `Profile.tsx:73-84` invalida `["notifications"]` sem `userId`; `limit 50` sem paginação.

### 1.7 Restaurantes / Lojas — CONCLUÍDA (MVP)
`20260820000000_business_profiles_tables.sql:9-81` (`profile_type business`, `consumption_options`, `menu_categories`+`menu_items`), `20260820030000_business_categories.sql`, RPC `register_as_business`, selector `Login.tsx:121-146`, `BusinessEdit.tsx:48-514` (consumption_options, ManageList, MenuItems), `BusinessDetail.tsx:38-178` (`sendOrder` com `waUrl` + `rpc record_business_order` + valida `entrega`+morada `149`), `BusinessDashboard.tsx:29-102`, rotas `App.tsx:68-69,76`, switch `Index.tsx:17-35`/`Explore.tsx:17-35` `servicos|lojas`. **Falta por desenho:** sem pagamento online (`orders.sql:1-3` "sem pagamento — WhatsApp"), `orders` sem `status`/`user_id` cliente (sem histórico cliente), sem stock/`available`, sem `opening_hours`, sem galeria (só `photo_url` único).

### 1.8 Painel Admin — CONCLUÍDA
`AdminDashboard.tsx:146-350` `loadAll` 11 queries paralelas, Realtime admin `231-247` 10 tabelas, Overview `622-661`, Providers `664-681` tabs+`providerCard 422-532` (MiniBars 7 dias, quality, portfolioCount, toggle/approve/reject), Verificações `684-723` `createSignedUrl 293-298`, Denúncias `726-802` `setComplaintStatus`, Avaliações `805-859`, Pedidos `861-887`, Categorias/Bairros/Stats. Rota `App.tsx:64-65`. **Falta:** sem paginação (full load; 500+ prestadores lento), sem logs/auditoria de quem aprovou, sem ban temporário (só `admin_delete_user` `250-253`).

### 1.9 Denúncias — PARCIAL
Tabela `complaints` (`types.ts:431-480`), UI `ProviderDetail.tsx:22-28,328-409,136-164` idem `BusinessDetail.tsx`, migrations `20260819010000_complaints_review_flow.sql:14-104` (RLS admin), `20260819030000_complaint_contact_and_notify_fix.sql:12-46` (FK fix `p.user_id FROM profiles`), `20260819020000_anonymous_complaints.sql:11-26` (`client_id nullable`, `Anyone can insert WITH CHECK status='pendente' AND (client_id IS NULL OR =auth.uid())`), admin `307-312` `setComplaintStatus`, Realtime. **Falta:** anon pode spammar sem limite diário (diferente de `service_requests` com `check_request_spam` 3/dia); sem feedback/tracking para denunciante; `contact` visível admin sem consentimento LGPD explícito.

### 1.10 Favoritos — NÃO EXISTE
`grep -rn favorites|favorito|bookmark src` = 0; sem tabela `favorites` em `types.ts` nem migrations; `Profile.tsx:43-68` sem lista; `ProviderCard.tsx` sem coração; `App.tsx:55-79` sem `/favoritos`.

### 1.11 PWA — PARCIAL
`manifest.json:1-33` (`Bornaal`, `standalone`, `theme #16a34a`, ícones 192+512), `index.html:12` manifest+theme+apple, `main.tsx:17-23` registra `/sw.js`, `sw.js:1-60` (`skipWaiting`, limpa caches, handlers `push 23-38`+`notificationclick 40-59` com `whatsapp_url`, **sem cache proposital** `5-6`), `InstallPrompt.tsx:1-105` (`beforeinstallprompt`, delay 2500ms, iOS instruções, `ASKED_KEY`), `PushPrompt.tsx:19-42` delays, `PushRepair.tsx:25` VAPID, `App.tsx:52-54`. **Falta:** sem Workbox/offline (sem rede = falha), sem `screenshots/shortcuts` no manifest, sem `background_sync`, iOS push só após Add to Home Screen sem aviso, `CACHE_VERSION` declarado mas nunca usado para `put`.

---

## 2. BUGS

### 2.1 Imports / variáveis / funções em falta
- `src/integrations/supabase/types.ts:618-629` — `service_requests` tem `Update` duplicado (sobrescrito, geração quebrada).
- `types.ts:309` FK `push_subscriptions_user_id_fkey` referencia `referencedRelation:"users"` (deveria `auth.users`).
- `types.ts:749-787` `Functions` não declara `upsert_push_subscription` nem `record_business_order` correto; chamadas usam `as never` (`useRequests.ts:197`, `ProviderDetail.tsx:115`, `BusinessDetail.tsx:214`).
- `useProviders.ts:99-107` `useBusinessCategories` consulta `business_categories` inexistente em `Database["public"]["Tables"]` (type-unsafe, passa por `skipLibCheck:true`).
- `Profile.tsx:118-119` `user?.name?.split` — `User` Supabase não tem `name` (é `user_metadata.name`); sempre `undefined`, iniciais falham silenciosamente.
- `PushPrompt.tsx:14` `isStandalone` importado nunca usado.
- `lib/push.ts:33,35,37` + `PushPrompt.tsx:54,63` `localStorage/sessionStorage` sem `try/catch` — lança `DOMException` em modo privado.
- `client.ts:20` `storage: localStorage` sem guard `typeof window` — falha em SSR/test.
- `lib/push.ts:6` fallback VAPID hard-coded dessincronizado de `Deno.env.get("VAPID_PUBLIC_KEY")` (`push-send/index.ts:7`) — rotação quebra `subscriptionMatchesVapidKey`.
- `tsconfig.json:7` `allowJs:true` mas `eslint.config.js:10` só cobre `ts,tsx` — `public/sw.js` não lintado.

### 2.2 Promises sem catch / Supabase sem tratamento de erro
- `useAuth.ts:33` `from("user_roles").select().eq()` só `{data}` — `error` ignorado → RLS/network falha deixa `roles=[]` silencioso, `isAdmin` falso negativo.
- `useProviders.ts:38-46`, `useProviderStats.ts:23-27,84-91` acessam `.data` sem checar `.error`.
- `lib/push.ts:91` `.delete().eq("user_id",userId).catch(()=>{})` engole erro — desinscrição parece OK mas permanece no BD.
- `ProviderCard.tsx:43` `supabase.rpc("record_provider_contact").then(...)` sem `.catch` — `TypeError` vira `UnhandledPromiseRejection`.
- `ProviderDetail.tsx:54,80,87` e `BusinessDetail.tsx:72,121,128` `rpc increment_provider_view/record_provider_contact` e `portfolio` `then(({data})=>...)` sem `error`.
- `Requests.tsx:517-518` `executePublish()` sem `await` no botão "Continuar sem conta" — dialog aberto, duplo clique possível.
- `AdminDashboard.tsx:177-227` `loadAll` `Promise.all` 11 queries sem `error` — qualquer falha RLS/network produz `null` silencioso, UI parcial.
- `Profile.tsx:57-63` `maybeSingle().then(({data})=>...)` sem `error`.
- `main.tsx:19` `serviceWorker.register` cobre register mas `withTimeout(ready,15000)` (`push.ts:56,62`) pode rejeitar timeout sem catch (`PushRepair.tsx:34-36`, `usePushSettings.ts:54,103`).
- `push-send/index.ts:31,93` `getSubscriptions` throw mas `whatsappUrlForNotification:93-123` engole com `try{}catch{}` e retorna "" sem log.
- `push_notifications.sql:84-88` trigger usa anon key hard-coded — expira silenciosamente.

### 2.3 Lógica / runtime bugs
- `ProviderDetail.tsx:228` `provider.id !== user?.id` e `BusinessDetail.tsx:302` `String(business.id) !== user?.id` — compara `profiles.id` com `auth.users.id` → sempre `true`; dono vê "Denunciar" no próprio perfil. Correto: `provider.user_id !== user?.id`.
- `ProviderDetail.tsx:52-57` + `BusinessDetail.tsx:51-75` `viewLogged useRef(false)` impede re-log se `id` muda via SPA mesma instância — segunda loja não conta vista.
- `Index.tsx:45-47` + `Explore.tsx:45-47` `useEffect if(qParam) setSearch(qParam)` só sincroniza quando truthy — limpar `?q=` mantém `search` obsoleto.
- `Requests.tsx:138-139` anti-spam anon `eq("requester_phone", phone)` sem normalização (`replace(/\D/g,"")` só no WhatsApp) — `+245 957...` vs `957...` contorna limite 3/dia.
- `usePushSettings.ts:36-41` `.limit(1)` sem `.order` — se 2 devices, linha não-determinística; `togglePush/setNovidades` podem operar no device errado.
- `usePushSettings.ts:51-72` `useEffect([subscription,refetch])` chama `refetch()` dentro do efeito que depende de `subscription` — loop infinito se `keys.p256dh` vazio.
- `usePushSettings.ts:99-112` `setNovidades` só `if(existing)` — sem `PushSubscription` no browser mas com `granted` não persiste, sem feedback.
- `usePushSettings.ts:74-77` `permission = useMemo(()=>getPermission(),[userId])` nunca reage a mudança `Notification.permission` após `requestPermission` — fica stale.
- `InstallPrompt.tsx:31-35` timeout captura `deferred` stale (`null` no closure inicial) — pode nunca abrir em Android na primeira visita.
- `lib/pagination.ts:1-2` `getPageCount(total,pageSize)` retorna 1 para `total=0` (`Math.max(1, Math.ceil(0/10))=1`); `pageSize=0` ⇒ `Infinity`.
- `Profile.tsx:71-86` canal Realtime sem `filter:user_id=eq.xxx` — recebe INSERTs de todos e invalida global.
- `Login.tsx:66-70` `if(data.session) rpc` — se confirmação email ON, role não atribuída.
- `lib/push.ts:48-52` `withTimeout` cria `setTimeout` sem `clearTimeout` se resolve antes — vazamento timer.
- `index.html:32-61` script inline chunk-retry replica `chunkError.ts:3-52` com `patterns` diferentes (4 vs 6, falta `"error loading dynamically imported module"` e `"Unable to preload CSS"`).

### 2.4 Supabase / Migrations inconsistentes
- `push_notifications.sql:86` trigger usa anon key hard-coded — rotação quebra push silenciosamente.
- `orders.sql:5-30` `orders` escrita só via RPC mas `BusinessEdit.tsx:106` tenta `select count` sem RLS anon — ok mas `record_business_order GRANT anon,authenticated` permite anon criar pedidos sem limite.
- `useRequests.ts:113-124` `count>=5` fecha `service_requests` para `closed` via `update` direto — se RLS não permitir, falha silenciosa (sem `error` checado).
- `20260817000000` e `20260817020000` redefinem `increment_provider_view/record_provider_contact` sem `DROP` — última vence sem garantia de `GRANT` (corrigido só em `20260817070000`).

---

## 3. SEGURANÇA

### 3.1 RLS — ativo em TODAS as tabelas?
**Sim, todas as tabelas aplicacionais têm `ENABLE ROW LEVEL SECURITY` no estado final.**
| Tabela | RLS | Evidência |
|--------|-----|-----------|
| `user_roles` | ✅ | `20260308190332:13` |
| `profiles` | ✅ | `20260308190332:42`, `20260816180000:39-47` |
| `service_requests` | ✅ | `20260308190332:58` |
| `reviews` | ✅ | `20260308190332:74` |
| `portfolio_images` | ✅ | `20260308200715:11` |
| `messages` | ✅ | `20260308200715:39` |
| `proposals` | ✅ | `20260606133810:24` |
| `categories` | ✅ | `20260608064654:9` |
| `bairros` | ✅ | `20260816130000:9` |
| `request_bids` | ✅ | `20260816160000:23` |
| `notifications` | ✅ | `20260816170000:18` |
| `provider_stats` | ✅ | `20260817000000:18` |
| `provider_activity` | ✅ | `20260817020000:20` |
| `complaints` | ✅ | `20260818000000:18` |
| `quality_levels` | ✅ | `20260818000000:48` |
| `menu_categories` | ✅ | `20260820000000:31` |
| `menu_items` | ✅ | `20260820000000:62` |
| `orders` | ✅ | `20260820010000:15` |
| `push_subscriptions` | ✅ | `20260820100000:18` |
| `business_categories` | ✅ | `20260820030000:10` |
| `storage.objects` (`avatars/portfolio/verification`) | ✅ | `migration_completa.sql:374-418`, `20260816180000:18-33` |

**Divergência perigosa:** `migration_completa.sql:172-178` e `rls_fix_seguro.sql:1-50` contêm snapshot antigo com policies diferentes do histórico incremental. Se re-executar `migration_completa.sql` em prod, recria vulnerabilidades já corrigidas (ex: `service_requests` volta a `anon WITH CHECK (true)`, `reviews` volta a `anon insert`).

### 3.2 Policies permissivas — quem pode ler/editar/apagar o que não devia?
| # | Gravidade | Tabela/Policy | Problema | Evidência |
|---|-----------|---------------|----------|-----------|
| P1 | **CRÍTICO** | `service_requests` `Public can create requests WITH CHECK (true)` | Anon pode criar pedidos ilimitados (flood). `user_id` nullable após `20260604151840:2`. | `20260604151840:11-15`, `migration_completa.sql:177-178` |
| P2 | **CRÍTICO** | `service_requests` `Authenticated can view requests USING (true)` | Authenticated vê TODOS os pedidos incluindo `requester_phone/name` de anons. | `20260608065349:26-30` |
| P3 | **ALTO** | `request_bids` `Authenticated can view bids USING (true)` | Todos auth vêem todas candidaturas (leak estratégia). | `20260816160000:26-27` |
| P4 | **ALTO** | `notifications` `System can insert WITH CHECK (true)` | Qualquer auth pode forjar notificação para qualquer `user_id`. | `20260816170000:26-28`, `20260817060000:32` |
| P5 | **ALTO** | `notifications` `Service role can update USING (true) WITH CHECK (true)` | Qualquer auth pode `UPDATE` qualquer notificação. | `20260817060000:35-36` |
| P6 | **ALTO** | `provider_stats`/`provider_activity` `Service role can insert/update WITH CHECK (true)` | Qualquer auth pode forjar estatísticas. | `20260817060000:13-27` |
| P7 | **CRÍTICO** | `orders` `Orders viewable by authenticated USING (true)` | Todos auth vêem todos pedidos restaurante (`items,total,address`). | `20260820010000:21-22` |
| P8 | **MÉDIO** | `profiles` `Profiles are viewable by everyone USING (true)` | Telefone/location/verification expostos a anon (PII público). Intencional marketplace mas sem minimização. | `20260308190332:44` |
| P9 | **ALTO** | `complaints` `Anyone can insert WITH CHECK (status='pendente' AND (client_id IS NULL OR =auth.uid()))` | Anon pode spammar denúncias para qualquer `provider_id`. | `20260819020000:17-22` |
| P10 | **MÉDIO** | `portfolio_images`/`menu_items` `viewable by everyone USING (true)` | Público (ok marketplace). | `20260820000000:37-38,68-69` |
| P11 | **ALTO→MÉDIO** | `reviews` historicamente `anon WITH CHECK (true)` | Após `20260822000000:18-22` exige `auth` mas `migration_completa.sql:235-236` reintroduz anon se re-executado. | `20260822000000:18-22` vs `migration_completa.sql:235-236` |
| P12 | **MÉDIO** | `profiles` `Providers can update own profile` com `COALESCE(is_verified,false)=false` | Se já `is_verified=true`, prestador fica bloqueado de editar próprio perfil (DoS). | `20260816180000:43-46` |
| P13 | **MÉDIO** | `request_bids` `Request owners can update bids WITH CHECK (true)` | Dono pode `UPDATE` para qualquer `status` arbitrário, sem audit. | `20260816160000:40-48` |

Grants amplos `GRANT SELECT,INSERT TO anon` mantidos em várias tabelas mesmo após policies restringirem — inofensivo mas deixa superfície se policy for dropada.

### 3.3 Chaves / segredos expostos no frontend?
| Achado | Veredito | Evidência |
|--------|----------|-----------|
| `VITE_SUPABASE_PUBLISHABLE_KEY` (anon JWT) no bundle | **Esperado — é publishable/anon, feita para ser pública; RLS protege** | `client.ts:11-13`, `.env:2`, `.env.production:2` |
| Hardcode fallback no `client.ts` | Mau padrão mas não leak `service_role`; expõe `project_id`+URL no repo | `client.ts:8-13` |
| `VITE_SUPABASE_URL` / `VITE_VAPID_PUBLIC_KEY` | Públicas por design | `.env:3-5` |
| `service_role` / `VAPID_PRIVATE_KEY` | **NÃO expostos no frontend** — só via `Deno.env.get` na edge function | `push-send/index.ts:4,8` |
| Anon key hard-coded dentro do Postgres | Anti-padrão: `net.http_post Authorization: Bearer eyJ...` em triggers `push_*` — expõe chave em dump SQL, deveria usar `vault`/`service_role` | `push_notifications.sql:86,120` |
| `.env` vs `.env.production` | `.env` ignorado, mas `.env.production` **comitado** com anon key + project_id (`!.env.production` no gitignore) | `.gitignore:15-19`, `.env.production:1-3` |
| `supabase/config.toml` | Só `project_id`, sem segredos | `config.toml:1` |

**Conclusão:** nenhum `service_role` no bundle. Risco real é RLS permissiva, não a chave.

### 3.4 Formulários — validam bem?
| Formulário | Frontend | Backend | Falhas |
|------------|----------|---------|--------|
| Cadastro `Login.tsx:51-75` | `password<6`, `name.trim()`, HTML5 `email` | Auth exige email único + pwd≥6 | Sem `zod` (instalado `package.json:68` nunca usado), `+alias@gmail.com` cria 1000 contas, `name` sem sanitize → XSS em `ProviderDetail.tsx:178` |
| Login `42-49` | Sem lockout | Supabase default | Sem rate-limit |
| Perfil `ProviderDashboard.tsx:181-209` | `!name/category/phone/location` + `trim()` | CHECKs só `verification_status/price_type/consumption_options` | `phone TEXT` sem CHECK, `description` sem limite/sanitize, `parseInt` sem NaN check |
| Pedido `Requests.tsx:73-415` | `!category`, `description.trim()`, `maxLength 80/25/500` client-only | `budget_amount>=0` apenas | `category` sem FK `categories`, `requester_phone` TEXT livre |
| Avaliações `ProviderDetail 100-134` | `rating<1`, `reviewerName`, `!user` | `rating 1-5` OK | `comment` sem limite/sanitize → XSS via `r.comment` (`ProviderDetail.tsx:309-316`), auto-avaliação permitida, spam ilimitado `request_id NULL` |
| Denúncias `ProviderDetail 136-164` | `reason/description` | `status CHECK` mas só insert | Sem sanitize/limite, `reason` é `t(label)` traduzido — bypass possível |
| Galeria `ProviderDashboard 122-141` | `size>5MB` | `image_url TEXT` sem CHECK | `file.type` não validado (bypass `accept="image/*"`), sem limite DB além de `MAX_GALLERY=4` frontend |
| Verificação `150-179` | `size>5MB` | Bucket privado OK | `mime` não validado (`image/*,.pdf` bypass), `verification_doc_url` sem validação |
| Encomenda `BusinessDetail 145-178` | `cartItems`, `consumption`, `address` | `record_business_order` valida `total>=0` e `items` estrutura (`orders.sql:64-91`) — **boa** | `total` vs soma `items` não validado frontend |

Geral: `zod` nunca usado, sem `DOMPurify/sanitizeHtml` — todo `description/comment/reason` renderizado cru.

### 3.5 Proteção contra spam/abuso
| Vetor | Proteção | Bypass |
|-------|----------|--------|
| Contas | Nenhuma (sem CAPTCHA, sem confirm obrigatória) | Bot `user+N@gmail.com` via `auth.signUp` + `register_as_provider` |
| Pedidos | Frontend throttle anon `count≥3/dia` por `requester_phone`, auth `10/dia` por `user_id` (`Requests.tsx:137-149`) | Trocar `phone` a cada 3 ou criar nova conta; **sem CHECK DB** |
| Avaliações | Trigger exigia `concluido+bid` mas `20260822000000` reabriu `NULL` sem limite | Loop `INSERT reviews request_id=NULL` flood |
| Denúncias | `WITH CHECK status='pendente'` apenas | Anon flood `POST /rest/v1/complaints` sem limite |
| Views/WhatsApp | `SECURITY DEFINER` sem rate-limit, `grant anon` (`20260817070000:4-5`) | Refresh loop inflaciona `provider_stats` + spam `notifications` |
| Portfolio | `MAX_GALLERY=4` + `5MB` frontend | API direta `storage.upload` + `insert` bypass |
| Push subs | Nenhum throttle | Flood `push_subscriptions` com endpoints falsos |

**Resumo:** única defesa é contagem client-side em `Requests.tsx` e `MAX_GALLERY`. **Sem CAPTCHA/honeypot/anon rate-limit/UNIQUE anti-spam.**

### 3.6 Rotas de admin — protegidas?
| Camada | Estado | Evidência |
|--------|--------|-----------|
| Router `App.tsx:64-65` `/admin` e `/admin-moderacao` | **DESPROTEGIDA** — sem wrapper `ProtectedRoute/RequireAdmin` | `App.tsx:64-65` |
| Guard client-side `AdminDashboard.tsx:171-175` | Só `useEffect` após render; flash-of-content, `loadAll` só se `isAdmin` mas componente monta antes do redirect | `AdminDashboard.tsx:171-175`, `useAuth.ts:32-34` |
| RLS como defesa real | **RLS salva leak de dados** — tabelas só retornam se `has_role(admin)` (`20260608064654:11-13`, `20260819010000:34-43`) → utilizador normal vê lista vazia, não dados alheios | Migrations RLS |
| Operações admin | `rpc admin_delete_user` verifica `has_role(admin)` server-side (`20260820020000:17`); `update profiles` bloqueado por RLS se não admin | `AdminDashboard.tsx:250-267` |
| Falta defesa profundidade | Sem middleware server, sem claims JWT `is_admin`, sem `storage` DELETE admin-only | `useAuth.ts:33` |

**Veredito:** URL admin é acessível a qualquer utilizador; proteção é **apenas RLS + redirect JS**. Sem vazamento se RLS íntegra, mas com disclosure via timing e enumeração.

---

## 4. ESTRUTURA / CÓDIGO

### 4.1 Ficheiros duplicados / código morto
- `Index.tsx:1-176` e `Explore.tsx:1-176` **100% duplicados** (PAGE_SIZE, SectionKey, filtros, goSection). Só difere `t("home.*")` vs `t("explore.*")` — deveria ser hook/componente compartilhado.
- `lib/locations.ts:1-22` (`LOCATIONS` estático 11 bairros) vs `useBairros.ts:6-10` (Supabase `bairros`) + fallback `bairros.length ? [...bairros] : BAIRROS_FILTER` em `Index/Explore/Requests` — duplicação fonte verdade.
- `components/ui/*` (~50 ficheiros shadcn) muitos nunca importados: `calendar.tsx`, `chart.tsx`, `carousel.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `resizable.tsx`, `drawer.tsx`, `hover-card.tsx`, `context-menu.tsx`, `input-otp.tsx`, `table.tsx`, `progress.tsx`, `slider.tsx` — bundle morto (já em `vite.config.ts:27-46` `radix` manualChunk lista `@radix-ui/react-toast` existe mas `sonner` duplicado).
- `public/sw.js:7` `CACHE_VERSION="bornaal-v1"` declarado nunca usado para `caches.open/put` (intencional "sem cache" mas variável morta; `activate` apaga tudo exceto ela).
- `BusinessEdit.tsx:71` componente declarado `const BusinessDashboard = () =>` mas ficheiro é `BusinessEdit.tsx` e lazy import `App.tsx:27` como `BusinessEdit` — nome interno errado (DevTools/displayName).
- Verificação doc: `ProviderDashboard.tsx:150-179` idêntico a `BusinessEdit.tsx:172-201` (upload doc/selfie 5MB, bucket `verification`, update) — 30 linhas duplicadas.

### 4.2 Inconsistências nomenclatura
- Migrations mistura `20260308...` (uuid) com `20260817..._nome_semântico`; `business_categories` (tabela) vs `BAIRROS_FILTER` (const Pt) vs `bairros` (tabela) — Pt/En (`provider/prestador/loja/business/bairros`).
- `useAuth.ts:5` `AppRole admin|provider|client|business` vs `app_role` enum ordem diferente `types.ts:783` — não bug mas inconsistência.
- `Layout.tsx:6` `logo.png` vs `About.tsx:6`/`Models.tsx:3` `logotipo.png` vs `Landing.tsx:9` `logo.png` — dois assets logo sem alias (`logo.png` vs `logotipo.png`).
- `AdminDashboard.tsx:67-78` `MenuKey` `"lojas-categorias"` com hífen, state `menu` sem `searchParams` — refresh perde aba.
- `useProviderStats.ts:5-9` snake_case (`profile_views`) vs `format.ts:1` camelCase (`formatCFA`) — API expõe snake sem mapeamento.
- `i18n locales` prefixos `admin.*` vs `providerDashboard.*` camelCase inconsistente.

### 4.3 Dependências não usadas / mal configuradas
- `package.json:47-68` inclui `@hookform/resolvers`, `react-hook-form`, `zod`, `input-otp`, `embla-carousel-react`, `cmdk`, `vaul`, `recharts` (só `AdminDashboard` não usa `recharts` — gráfico é `MiniBars` divs), `date-fns`, `react-day-picker`, `react-resizable-panels` — nenhuma página importa `recharts/cmdl/vaul/react-hook-form/zod` exceto `form.tsx` (shadcn form) nunca usado (nenhum `useForm`).
- `bun.lock` (245KB) + `package-lock.json` (299KB) ambos presentes — conflito lockfile; CI deve escolher um.
- `eslint.config.js:23` `"@typescript-eslint/no-unused-vars":"off"` desativa detecção código morto (ex: `isStandalone`).
- `tsconfig.json:7-12` `noUnusedLocals:false`, `noUnusedParameters:false`, `strict:false`, `strictNullChecks:false`, `tsconfig.app.json:24-25` — TS não aponta `provider.user_id` bug nem `user.name`.
- `vite.config.ts:15` `mode==="development" && componentTagger()` retorna `false` filtrado por `filter(Boolean)` — ok mas type-unsafe.
- `vercel.json:3` SPA fallback sem `cleanUrls` — `/admin-moderacao` mesmo componente de `/admin` sem redirect canónico duplicado para SEO.

### 4.4 Realtime / polling inconsistente
- `useNotifications.ts:32,48` polling `10000` + `useNotificationsRealtime 52-79` + `NotificationBell.tsx:23` + `Profile.tsx:72-85` todos subscrevem `notifications` com canais diferentes (`notifications-${userId}-${uuid}`, `profile-stats-${profileId}-${uuid}`) — múltiplas conexões, risco limite Supabase (200/cliente), `removeChannel` por componente.
- `useProviderStats.ts:35,94,130` `refetchInterval 10000/15000` + realtime mesmos dados — polling redundante, deveria ser só realtime.
- `AdminDashboard.tsx:231-248` canal `admin-live-${uuid}` 11 `postgres_changes` cada `()=>loadAll()` (full reload 11 selects) sem debounce — qualquer `UPDATE profiles` dispara 2 triggers (profiles + provider_stats) = 2 reloads sequenciais.

### 4.5 Assets / PWA
- `manifest.json:13-32` ícones `/icon.png` 512 duplicado (`any` + `maskable` mesmo src); falta `icon-512 maskable` croppado; `index.html:9` `/icon.png` mas manifest `"/icon-192.png"` 192 existe — inconsistência `theme_color` OK mas `sw.js` badge `/icon-192.png`.
- `public/robots.txt` existe; `index.html:18-27` OG `social-images` aponta `storage.googleapis.com/gpt-engineer-file-uploads/...` domínio externo não controlado, sem `og:url`.

---

## 5. PRIORIDADES ORDENADAS (CRÍTICO → IMPORTANTE → PODE ESPERAR)

### 🔴 CRÍTICO — impede lançamento seguro (corrigir ANTES do domínio/público)
1. **RLS permissiva: anon cria pedidos + vê todos pedidos + vê todas encomendas** — `service_requests WITH CHECK (true)` (P1) e `orders USING (true)` (P7) + `P2 USING (true)` leak telefone. Sem isto, bot flood e leak PII. *Refs: `20260604151840:11-15`, `20260608065349:26-30`, `20260820010000:21-22`*
2. **Notificações/stats forjáveis por qualquer auth** — `notifications WITH CHECK (true)` (P4) + `service role can update USING (true)` (P5) + `provider_stats WITH CHECK (true)` (P6). Permite spoof e forjar métricas. *Refs: `20260817060000:13-36`, `20260816170000:26-28`*
3. **Sem anti-spam em avaliações diretas + denúncias anon** — flood ilimitado `reviews request_id NULL` (1.4) + `complaints Anyone can insert` (P9). Um atacante enterra reputação ou DoS admin. *Refs: `20260822000000:79-83`, `20260819020000:17-22`, `ProviderDetail.tsx:100-134`*
4. **Cadastro sem role se email confirmation ON** — utilizador paga depois fica sem perfil; suporte explode. Mover `register_as_provider/business` para trigger `after insert auth.users` ou desabilitar `confirm email` e documentar. *Refs: `Login.tsx:66-70`, `useAuth.ts:32-35`*
5. **`migration_completa.sql` reintroduz vulnerabilidades** — se alguém reaplicar o snapshot, volta `anon reviews` e `service_requests anon`. Arquivar/atualizar snapshot para refletir estado final ou remover do deploy. *Refs: `migration_completa.sql:172-236`*
6. **Rotas admin sem guard + RLS como única defesa** — acessível a qualquer utilizador (`App.tsx:64-65`), flash-of-content; se uma policy falhar, leak total. Adicionar `ProtectedRoute` que verifica `isAdmin` antes de montar. *Refs: `App.tsx:64-65`, `AdminDashboard.tsx:171-175`*
7. **XSS persistido em `comment/description/reason`** — sem sanitize, `r.comment` renderizado cru (`ProviderDetail.tsx:309-316`, `AdminDashboard.tsx:754`). Atacante injeta `<script>` via avaliação/denúncia. Adicionar `DOMPurify` ou escape e CHECKs DB. *Refs: `ProviderDetail.tsx:100-164`, `types.ts`*
8. **Bug `provider.id !== user?.id` (RBAC denúncia)** — dono vê "Denunciar" no próprio perfil e pode auto-denunciar/validar fluxo; comparar `profiles.user_id` vs `auth.uid`. *Refs: `ProviderDetail.tsx:228`, `BusinessDetail.tsx:302`*
9. **Segredo `.env.production` comitado** — embora anon, expõe `project_id` + URL no Git histórico; `!.env.production` no `.gitignore:18-19` deveria ser revertido; usar secrets Vercel/Supabase Vault. *Refs: `.gitignore:18-19`, `.env.production:1-3`, `client.ts:8-13`*

### 🟠 IMPORTANTE — deve corrigir antes/depois do lançamento (curto prazo)
10. **Validação formulários frontend-only + `zod` instalado nunca usado** — `package.json:68` `zod` 0 uses; `phone` sem regex, `description` sem limite. Adicionar schemas `zod` + `react-hook-form` e CHECKs DB (`phone` regex, `name length`, `comment max 500`). *Refs: `Login.tsx:53`, `ProviderDashboard.tsx:184`, `Requests.tsx:176`, `package.json:68`*
11. **Push com anon key hard-coded no Postgres + Edge Function não versionada** — `push_notifications.sql:86,120` `net.http_post` com JWT; rotação quebra push silenciosamente. Usar `vault`/`supabase_functions` + versionar `push-send` no repo com `SUPABASE_SERVICE_ROLE_KEY` via secrets. *Refs: `20260820100000:86,120`, `push-send/index.ts`*
12. **Avaliações: média e qualidade contam spam** — `avgRating` e `quality_levels` sem distinguir diretas vs via pedido; sem `UNIQUE(user_id,provider_id) WHERE request_id IS NULL` nem cooldown. Decidir fluxo canónico e adicionar constraint + UI "aguarda moderação". *Refs: `useProviders.ts:72-77`, `20260822000000`*
13. **Falta rate-limit/captcha em cadastro/login/pedidos** — bot cria 1000 contas/pedidos. Adicionar CAPTCHA (hCaptcha/Cloudflare Turnstile) e `pg_cron`/`check_request_spam` DB. *Refs: `Login.tsx:51-75`, `Requests.tsx:137-149`*
14. **Tratamento de erro silencioso em Supabase** — `useAuth.ts:33`, `AdminDashboard.tsx:191-202`, `ProviderDetail.tsx:58-63` ignoram `error`; `push.ts:91 catch(()=>{})` engole. Propagar `error` para toast e Sentry. *Refs: `useAuth.ts:33`, `AdminDashboard.tsx:177-227`*
15. **Duplicação `Index.tsx` vs `Explore.tsx` (100%) + `locations.ts` vs `bairros`** — dívida técnica alta; bug corrigido num não corrige no outro. Extrair `useFilteredProviders` e `useBairros` como fonte única. *Refs: `Index.tsx:1-176`, `Explore.tsx:1-176`, `lib/locations.ts:1-22`*
16. **`localStorage` sem `try/catch` + `storage: localStorage` sem guard** — quebra em modo privado/SSR/test. Envolver em `try/catch` e `typeof window`. *Refs: `push.ts:33`, `client.ts:20`*
17. **Realtime + polling redundante + 11 reloads admin sem debounce** — `useNotifications`+`useProviderStats` polling 10s + realtime; `admin-live` 11 `postgres_changes => loadAll()` sem debounce. Remover polling ou usar `staleWhileRevalidate` + debounce 500ms. *Refs: `useNotifications.ts:32,48`, `AdminDashboard.tsx:231-248`*

### 🟡 PODE ESPERAR — melhorias pós-lançamento
18. **Favoritos NÃO EXISTE** — feature retenção barata (tabela `favorites`, RLS, `ProviderCard` coração, `/favoritos`). *Refs: grep 0*
19. **PWA sem offline** — `sw.js:5-6` "sem cache de propósito"; avaliar `vite-plugin-pwa` runtimeCaching para GETs Supabase ou `offline.html`. *Refs: `sw.js:1-60`, `manifest.json`*
20. **Perfil bloqueado se `is_verified=true` (DoS prestador)** — policy `COALESCE(is_verified,false)=false` (`20260816180000:43-46`) impede editar próprio perfil se já verificado. Relaxar CHECK para permitir `UPDATE` sem mudar `is_verified/verification_status`.
21. **Dependências mortas + duplo lockfile** — `recharts`, `cmdk`, `vaul`, `embla-carousel`, `react-hook-form`, `zod` etc nunca importados; `bun.lock` + `package-lock.json` conflitam. `npm prune` + escolher `bun` ou `npm`. *Refs: `package.json:47-93`, `vite.config.ts:27-46`*
22. **Nomenclatura `BusinessEdit.tsx:71` `const BusinessDashboard` + assets `logo.png` vs `logotipo.png` + `MenuKey "lojas-categorias"` com hífen** — renomear para consistência. *Refs: `BusinessEdit.tsx:71`, `Layout.tsx:6`, `AdminDashboard.tsx:67-78`*
23. **Manifest ícones duplicados + OG externo** — `manifest.json:20-31` `/icon.png` duplicado `any+maskable`; `index.html:18-27` OG aponta `storage.googleapis.com/...` não controlado. Gerar `icon-512-maskable.png` e `og:url`. *Refs: `manifest.json:13-32`, `index.html:18-27`*
24. **Paginação `getPageCount(0)=1` e `pageSize=0=Infinity`** — `lib/pagination.ts:1-2`; corrigir `Math.max(1...)` para `0` quando `total=0` e guard `pageSize>0`. *Refs: `lib/pagination.ts:1-2`*
25. **Admin sem paginação/auditoria, business sem stock/horário** — `AdminDashboard.tsx:178-227` full `select *` sem `range`; `menu_items` sem `available`, `profiles` sem `opening_hours`. Roadmap futuro.

---

## Como verificar rapidamente (sem corrigir)
```bash
# RLS policies permissivas (WITH CHECK true)
rg -n "WITH CHECK \(true\)" supabase/migrations

# Chaves hard-coded
rg -n "eyJhbGci" supabase/migrations src

# Formulários sem zod
rg -n "zod" src

# Rotas admin sem guard
grep -n "path=\"/admin" src/App.tsx
```

*Atualização 2026-09-03: os ficheiros `migration_completa.sql` e `rls_fix_seguro.sql` referenciados acima **foram removidos do repositório** — não existem mais em disco. A fonte única de verdade é `supabase/migrations/*` incrementais. Não recriar snapshots antigos sem regenerar a partir do estado final.*

*Fim da auditoria — nenhum ficheiro foi modificado além da criação deste relatório.*
