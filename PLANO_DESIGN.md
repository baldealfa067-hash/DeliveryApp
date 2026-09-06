# Plano de Redesign — Sistema de Design

Documento de referência para o redesign visual da plataforma. Baseado em cinco referências de apps de comida (Laresto, Taco Bell, foodislice, Chili POS e um kit de encomenda de comida), adaptado à realidade da Guiné-Bissau.

---

## 1. Princípios que guiam este redesign

Antes das cores e das fontes, três decisões que condicionam tudo o resto:

**Clareza acima de estética.** O público inclui pessoas com pouca experiência de apps. Botões grandes, texto legível, ícones sempre acompanhados de palavras. Nunca um ícone sozinho a representar uma ação importante.

**Peso de dados é uma decisão de design.** As referências são todas cheias de fotografia grande de comida — lindo, mas cada foto custa dados ao utilizador. Isto obriga a: compressão agressiva, carregamento preguiçoso (lazy loading), placeholders com cor sólida enquanto carrega, e nunca carregar imagens que não estão no ecrã.

**Mobile primeiro, sempre.** As referências 4 e 5 são dashboards de computador — são boas inspirações para o painel do restaurante em ecrã grande, mas o restaurante em Bissau vai gerir pedidos no telemóvel. O layout de duas/três colunas só entra a partir de tablet.

---

## 2. O que já existe e se mantém

O projeto já tem uma base de design coerente. **Não deitar fora — refinar.**

```css
--primary: 145 63% 32%      /* verde */
--background: 45 20% 97%    /* creme quente, não branco puro */
--foreground: 150 30% 8%
--accent: 0 72% 45%         /* vermelho */
--radius: 0.75rem
```

O verde está alinhado com três das cinco referências. O fundo creme (em vez de branco puro) é uma escolha acertada — dá calor e reduz o cansaço visual. Mantém-se.

Stack: Tailwind + shadcn/ui + Recharts. Tudo já instalado, tudo se aproveita.

---

## 3. Sistema de cores refinado

### Paleta principal
| Papel | Valor | Uso |
|---|---|---|
| `--primary` | `145 63% 32%` | Ações principais, botões de confirmar, estados ativos |
| `--primary-light` (novo) | `145 45% 94%` | Fundos de destaque suaves, cartões selecionados, chips ativos |
| `--background` | `45 20% 97%` | Fundo da app |
| `--card` | `0 0% 100%` | Cartões (branco puro sobre creme — cria separação sem sombras pesadas) |
| `--accent` | `0 72% 45%` | Alertas, ações destrutivas, badges de urgência |

### Cores de estado (novas — necessárias para os estados do pedido)
| Estado | Cor | Onde |
|---|---|---|
| Pendente / à espera | âmbar `38 92% 50%` | Pedido novo, comprovativo por validar |
| Em curso | azul `217 91% 60%` | Em preparação, a caminho |
| Concluído | verde `--primary` | Entregue, pagamento validado |
| Problema | vermelho `--accent` | Cancelado, comprovativo rejeitado |

Regra: **a cor nunca é o único indicador**. Sempre acompanhada de texto ou ícone — para daltónicos e para ecrãs de má qualidade sob sol forte.

---

## 4. Tipografia

Mantém a família atual (Space Grotesk), mas com escala mais generosa que o habitual. Os utilizadores incluem pessoas com dificuldade de leitura e telemóveis pequenos vistos ao sol.

| Nível | Tamanho | Peso | Uso |
|---|---|---|---|
| Display | 28px | 700 | Título de ecrã principal |
| Título | 20px | 600 | Nome do restaurante, cabeçalhos de secção |
| Corpo | 16px | 400 | Texto geral — **nunca abaixo de 14px** |
| Legenda | 13px | 500 | Metadados, timestamps |
| Preço | 18px | 700 | Preços — sempre destacados, cor primária |

---

## 5. Componentes-chave

### 5.1 Cartão de restaurante (lista/exploração)
Inspiração: referências 1 e 2.

- Foto do restaurante em cima, proporção 16:9, cantos arredondados no topo
- Nome (Título), categoria (Legenda), bairro com ícone de localização
- Badge de estado: "Aberto" (verde) / "Fechado" (cinza)
- Avaliação com estrela, se existir
- Cartão inteiro clicável, com feedback visual ao tocar
- **Altura mínima do alvo de toque: 48px** em qualquer elemento interativo

### 5.2 Item de menu
Inspiração: referência 2 (Laresto).

- Layout horizontal: foto quadrada à esquerda (80×80), texto ao centro, botão "+" à direita
- Nome, descrição curta (máx. 2 linhas), preço em destaque
- Botão "+" circular verde, 44px — grande e óbvio
- Quando já está no carrinho: mostra quantidade com "−" e "+" em vez do "+" simples

### 5.3 Categorias
Inspiração: referência 4 (foodislice, secção "Explore Categories").

**Correção importante face a uma primeira versão**: chips em fila horizontal com scroll escondido não é adequado — obriga a saber que se pode arrastar, o que não é óbvio para quem não está habituado a apps. A referência 4 resolve isto com uma **grelha**: ícone simples dentro de um círculo com fundo suave (`--primary-light`), nome por baixo, várias categorias visíveis ao mesmo tempo, sem nada escondido.

- Grelha de 4 colunas em telemóvel (ajusta para mais em ecrã largo)
- Ícone de contorno simples (lucide-react), não fotografia — mantém o objetivo de poupar dados
- Categoria ativa: círculo preenchido a `--primary`, ícone branco
- Categoria inativa: círculo com fundo `--primary-light`, ícone `--primary`
- Se houver mais categorias do que cabem em 2 linhas, mostrar as mais usadas e um último item "Ver todas" que abre a lista completa (nunca scroll horizontal escondido)

### 5.4 Navegação inferior (mobile)
Inspiração: referência 3 — botão central elevado.

- 5 posições: Início, Explorar, **Pedidos (elevado, destacado)**, Conversas, Perfil
- Ícone + palavra sempre (nunca só ícone)
- O item central elevado em círculo verde é uma boa ideia — usa-o para a ação mais importante de cada papel:
  - Cliente → Pedidos
  - Restaurante → Pedidos a decorrer
  - Motorista → Entregas disponíveis
- Badge numérico vermelho para itens por ver

### 5.5 Cartão de pedido (painel do restaurante)
Inspiração: referências 4 e 5 (painéis de gestão).

- Número do pedido grande, hora, valor total em destaque
- Lista de itens compacta
- Nome e telefone do cliente, com **botão de ligar sempre visível**
- Leitor de áudio da indicação de morada, com etiqueta
- Estado atual como badge colorido
- Ação principal como botão largo em baixo (ex: "Confirmar pedido")
- Estado do pagamento visível quando aplicável

### 5.6 Linha do tempo do pedido (cliente)
- Vertical, com círculos preenchidos para etapas concluídas
- Etapa atual destacada com anel colorido e animação suave de pulsação
- Etapas futuras em cinza claro
- Cada etapa com hora, quando já ocorreu
- Texto humano, não técnico: "O restaurante está a preparar" em vez de "em_preparacao"

### 5.7 Painel lateral (tablet/desktop, painel do restaurante)
Inspiração: referências 4 e 5.

Só a partir de 1024px de largura:
- Barra lateral esquerda com navegação (Pedidos, Menu, Vendas, Conta corrente, Perfil)
- Área central com a lista
- **Painel direito com o pedido selecionado** — é o padrão das duas referências de dashboard e funciona muito bem para gerir pedidos sem perder o contexto da lista

---

## 6. Espaçamento e layout

- Escala de 4px: 4, 8, 12, 16, 24, 32, 48
- Margem lateral do ecrã: 16px em telemóvel, 24px em tablet+
- Espaço entre cartões: 12px
- Espaço interno dos cartões: 16px
- **Respiração é fundamental** — todas as referências têm generoso espaço em branco; é o que separa uma app que parece profissional de uma que parece amadora

### Sombras
Suaves e subtis, nunca pesadas:
```css
--shadow-card: 0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04);
--shadow-elevated: 0 4px 12px rgb(0 0 0 / 0.08);
```

---

## 7. Estados vazios, carregamento e erro

Frequentemente esquecidos, mas é onde a app parece mal feita.

**Carregamento:** usar skeletons (blocos cinzentos com a forma do conteúdo), nunca spinners no meio do ecrã. Dá sensação de rapidez.

**Vazio:** ilustração ou ícone simples + frase clara + ação. Ex: motorista sem entregas → "Ainda não há entregas disponíveis. Fica disponível para receberes pedidos." + botão.

**Erro:** linguagem humana, nunca códigos técnicos. Sempre com um botão de "Tentar de novo".

**Offline:** a ligação em Bissau falha. Banner discreto no topo quando não há rede, e a app deve manter o que já carregou visível em vez de ficar em branco.

---

## 8. Ecrãs a redesenhar, por prioridade

1. **Exploração/Início (cliente)** — primeira impressão, é o que vende a app
2. **Detalhe do restaurante + carrinho** — onde acontece a conversão
3. **Checkout** — inclui a gravação de voz e a escolha de pagamento; tem de ser à prova de confusão
4. **Acompanhamento do pedido (cliente)** — onde o cliente passa mais tempo à espera
5. **Painel de pedidos (restaurante)** — usado o dia todo, tem de ser rápido de ler
6. **Painel do motorista** — usado em movimento, precisa de contraste alto e botões enormes
7. **Conta corrente (restaurante)** — clareza financeira
8. **Painel de administrador** — menos crítico, é interno

---

## 9. O que NÃO copiar das referências

- **Fotografia de comida em todo o lado** (referências 1, 2, 3) — bonito, mas caro em dados. Usar foto só onde ajuda a decidir: cartão de restaurante e item de menu. Não em listas de pedidos, histórico, ou painéis de gestão.
- **Preço riscado e descontos** (referência 4) — não temos promoções ainda; não desenhar componentes para funcionalidades que não existem.
- **Multiplicidade de métodos de pagamento com logos** (referência 4) — só temos Orange Money e dinheiro.
- **Densidade do POS** (referência 5) — desenhado para ecrã grande com rato; não replicar essa densidade em telemóvel.
- **Modo escuro elaborado** — já existe no CSS, mas não é prioridade de polimento agora.

---

## 10. Notas de implementação para o Claude Code

- Refinar os tokens em `src/index.css` — não criar um sistema paralelo
- Continuar a usar shadcn/ui; personalizar através das variáveis CSS, não com CSS solto
- Ir ecrã a ecrã pela ordem da secção 8, sem tentar tudo de uma vez
- Cada ecrã redesenhado deve ser testado num telemóvel real antes de passar ao seguinte
- Manter tudo traduzido nos quatro idiomas (pt/en/fr/kri) — já houve várias regressões neste ponto
- Nunca remover funcionalidade em nome do design; se algo parecer a mais, perguntar antes

---

## 11. Sobre a marca

Este documento trata do sistema visual, não da identidade. O nome novo e o logo ainda estão por decidir — quando estiverem, entram por cima deste sistema (cor primária pode ajustar-se ao logo, o resto mantém-se). O rebranding tem uma lista própria de ~60 referências a "Bornaal" espalhadas pelo código, que é um trabalho separado deste.

---

## Anexo — Desvios ao plano, e porquê

Registo dos pontos em que a implementação não segue o documento à letra. Cada um tem uma razão; se a razão deixar de valer, o desvio deve ser revertido.

**§5.1 — Badge "Aberto"/"Fechado" não existe.** A tabela `profiles` não guarda horário nem estado de abertura. Por §9 (não desenhar componentes para funcionalidades que não existem), o badge fica de fora até haver forma de o restaurante declarar que está aberto.

**§5.1 — O cartão da lista não tem botões de contacto.** Para restaurantes, a ação da lista é ver o menu, não negociar. WhatsApp e telefone vivem na página do restaurante.

**§5.3 — 3 colunas em telemóveis estreitos, 4 a partir de 430px.** Medido a 360px: uma célula de 4 colunas dá 76px e "Supermercado" ocupa 93px a 13px. Como 13px é o mínimo da escala (§4) e fechar o espaçamento não chegava, a 4ª coluna só entra quando a palavra cabe inteira. O número de lugares acompanha as colunas, para serem sempre 2 linhas.

**§6 — A utility Tailwind da sombra do cartão chama-se `shadow-soft`, não `shadow-card`.** O Tailwind gera utilities de cor de sombra a partir das cores do tema, e `shadow-card` colidia com a cor `card`: a regra de cor, emitida depois, pintava a sombra de branco. A variável CSS mantém o nome `--shadow-card`.
