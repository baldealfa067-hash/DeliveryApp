# DeliveryApp

Cópia base do **Bornaal** (`baldealfa067-hash/bornaal`) — marketplace Guinea-Bissau.

Todo conteúdo Bornaal foi copiado para `/DeliveryApp` incluindo:
- `src/` (30 páginas, components, hooks, i18n pt/en/fr/kri)
- `supabase/migrations/` (70+ migrations + 4 fixes 20260903*)
- `public/`, `index.html`, `vite.config.ts`, `vercel.json`

Próximos passos para tornar independente:
1. `cd DeliveryApp && git init && gh repo create baldealfa067-hash/deliveryapp --public --source=.`
2. Supabase novo: `supabase projects create deliveryapp` ou Dashboard → New Project → copiar `VITE_SUPABASE_URL/PUBLISHABLE_KEY` para `.env`
3. `supabase link --project-ref <NOVO_REF>` + `supabase db push` (envia as 70 migrations)
4. Atualizar `package.json:name` de `bornaal` → `deliveryapp` e `index.html` title.

GitHub e Supabase ainda **não criados** — pasta local pronta.
