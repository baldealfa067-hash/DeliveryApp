/**
 * Colunas de `profiles` que um visitante sem sessão pode ler.
 *
 * Até à Fase 1 o anónimo lia a tabela inteira, incluindo `merchant_code`,
 * `payment_number` e os caminhos dos documentos de verificação. O GRANT passou
 * a ser coluna a coluna, e por isso `select("*")` deixou de funcionar sem
 * sessão: o `*` expande para todas as colunas, incluindo as revogadas, e o
 * pedido inteiro falha com "permission denied".
 *
 * Quem lê perfis em rota pública (/inicio, /explorar, /loja/:id) tem de pedir
 * esta lista em vez de `*`. Manter em sincronia com a migração
 * `fase1_close_profiles_drivers_messages_to_anon` — se uma coluna for
 * acrescentada ao GRANT, acrescenta-se aqui; o contrário parte a navegação
 * anónima.
 *
 * `phone`, `lat` e `lng` estão de propósito nesta lista: o telefone é
 * informação de contacto do estabelecimento (decisão do dono, 2026-09-09) e as
 * coordenadas são a morada do negócio, não a localização de uma pessoa.
 *
 * Escrito como literal único com `as const`, e não como array com `.join()`:
 * o supabase-js infere o tipo das linhas a partir do texto literal passado a
 * `.select()`. Uma string construída em runtime tem tipo `string`, a inferência
 * colapsa em `GenericStringError` e rebenta todo o código que acede aos campos
 * do resultado.
 */
export const PUBLIC_PROFILE_COLUMNS =
  "id, user_id, name, category, description, location, photo_url, phone, lat, lng, profile_type, is_verified, verification_status, verification_submitted_at, consumption_options, prep_time_minutes, price_type, services, starting_price, bornaal_id, created_at, updated_at" as const;
