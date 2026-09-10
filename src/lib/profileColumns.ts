/**
 * Colunas de `profiles` que um visitante sem sessão pode ler.
 *
 * Até à Fase 1 o anónimo lia a tabela inteira, incluindo `merchant_code`,
 * `payment_number` e os caminhos dos documentos de verificação. O GRANT passou
 * a ser coluna a coluna, e por isso `select("*")` deixou de funcionar sem
 * sessão: o `*` expande para todas as colunas, incluindo as revogadas, e o
 * pedido inteiro falha com "permission denied".
 *
 * Desde 2026-09-10 isto já não vale só para visitantes sem sessão: as cinco
 * colunas privadas (`merchant_code`, `payment_number` e as três de
 * verificação) foram fechadas TAMBÉM a `authenticated`, porque qualquer conta
 * lia os dados de pagamento e os documentos de identidade de toda a gente.
 * Portanto `select("*")` em `profiles` não funciona para ninguém — nem com
 * sessão. Quem precisa das privadas usa as RPCs `get_business_payment_info`,
 * `get_my_profile_private` ou `admin_list_verifications`.
 *
 * TRÊS listas têm de andar sempre juntas — esta, o GRANT ao `anon` em
 * `fase1_close_profiles_drivers_messages_to_anon`, e o GRANT ao
 * `authenticated` em `close_profile_private_columns_table_level_revoke`.
 * Acrescentar uma coluna a uma e esquecer as outras parte a navegação.
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
