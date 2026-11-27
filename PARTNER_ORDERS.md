# Integração de pedidos do iTudoo

O iTudoo fornece a API para os sistemas de gestão dos restaurantes. O Gestão Pro é o primeiro parceiro e serve de exemplo. Qualquer outro sistema pode integrar-se diretamente, sem depender do Gestão Pro.

Cada ligação recebe uma credencial hexadecimal de 64 caracteres, associada a um restaurante. Guardar a credencial no servidor do parceiro e enviá-la em `Authorization: Bearer <token>`. O iTudoo armazena o hash SHA-256 e permite desativar a ligação.

O endereço de produção para chamadas autenticadas será `https://www.itudoo.com/api/partner-orders`. Usar diretamente o domínio com `www` para evitar o redirecionamento que pode remover o cabeçalho de autorização.

## Ler pedidos

`GET /api/partner-orders` devolve `{ "orders": [...] }`. Cada entrada inclui `id`, `updated_at` e `payload`. Guardar os dados pelo `id` do iTudoo. Para ler a página seguinte, enviar `after` e `after_id` com os valores da última entrada processada. Cada página contém até 100 pedidos. Guardar o cursor apenas após persistir os dados no parceiro.

## Atualizar o estado

`POST /api/partner-orders` recebe `{ "order_id": "<uuid>", "action": "ready" }`. As ações são `accepted`, `preparing` e `ready`. A resposta contém o estado efetivo em `status`. O parceiro deve usar esse valor ao reconciliar a sua fila. Repetir uma ação que já foi aplicada devolve o estado atual.

O iTudoo continua responsável pela atribuição do motorista e pela conclusão da entrega. O parceiro recebe os estados resultantes pela mesma consulta.

## Piloto

O script `scripts/sync-gestao-pro.mjs` usa esta API como qualquer parceiro. Aplicar a migração do iTudoo num ambiente de teste, publicar o endpoint e configurar a ligação de um restaurante antes de testar com o Gestão Pro.
