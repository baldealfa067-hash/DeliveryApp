#!/usr/bin/env node
/**
 * Move os ficheiros que ficaram no bucket PUBLICO `portfolio` para os buckets
 * privados, e reescreve as referencias na base de dados.
 *
 * Porque existe: os buckets privados entraram a 2026-09-17, mas os ficheiros ja
 * gravados ficaram onde estavam, a abrir por URL publica. Enquanto ali estiverem,
 * a morada falada de um cliente abre para qualquer pessoa que tenha o endereco.
 *
 *   notas de voz            portfolio -> notas-voz              (reescreve `orders`)
 *   comprovativo de pedido  portfolio -> comprovativos          (reescreve `orders`)
 *   comprovativo comissao   portfolio -> comprovativos-comissao (reescreve `commission_payments`)
 *
 * ORFAOS: comprovativos de pedido E notas de voz sem nenhum pedido ligado sao
 * MOVIDOS na mesma, nao apagados -- sao ficheiros de clientes reais (§56). Ficam
 * no bucket privado, sem referencia, ao alcance do proprio cliente e do admin.
 *
 * O QUE NAO SE MOVE, de proposito: `<uid>/chat/voice/...`. Sao mensagens de voz
 * de conversas, referenciadas em `messages.content`, e NAO sao notas de pedido.
 * O bucket `notas-voz` da acesso pelo PEDIDO (`pode_ouvir_nota_voz`: cliente,
 * dono do restaurante, motorista atribuido, admin) -- nao pela conversa. Mover
 * uma voz de chat para la tirava-a a quem a recebeu. Precisa de bucket e policy
 * proprios, que sao decisao do dono do projecto.
 *
 * O CAMINHO E PRESERVADO tal e qual (`<uid>/...`). Nao e cosmetico: as policies
 * comparam a primeira pasta com `auth.uid()`, e um caminho novo tirava o ficheiro
 * ao dono.
 *
 * Precisa da CHAVE DE SERVICO -- e a unica que le e apaga ficheiros de outra
 * pessoa. Por isso corre do lado do dono, nunca em CI nem no browser.
 *
 *   node scripts/mover-para-privado.mjs              # simulacao (nao altera nada)
 *   node scripts/mover-para-privado.mjs --executar   # move a serio
 *   node scripts/mover-para-privado.mjs --executar --manter-original
 *
 * Salvaguardas, todas a abortar o ficheiro em causa e nunca a adivinhar:
 *   - so mexe em objectos do `portfolio` cuja 1.ª pasta seja o dono esperado;
 *   - recusa se o destino ja existir com conteudo diferente;
 *   - confirma o tamanho do que chegou ao destino antes de seguir;
 *   - so apaga o original depois de a base de dados ja apontar para o destino;
 *   - revalida os orfaos no momento de mover (um pedido pode te-los ligado
 *     entretanto -- ai deixam de ser orfaos e sao tratados como ligados).
 */
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------- ambiente ---
function lerEnv() {
  const env = { ...process.env };
  try {
    for (const l of readFileSync(".env", "utf8").split("\n")) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* opcional */ }
  return env;
}
const env = lerEnv();
const URL_BASE = env.VITE_SUPABASE_URL;
const SERVICO = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !SERVICO) {
  console.error("Faltam VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env ou ambiente).");
  console.error("A chave de servico le e apaga ficheiros de qualquer pessoa: corre isto so do teu lado.");
  process.exit(1);
}

const EXECUTAR = process.argv.includes("--executar");
const MANTER = process.argv.includes("--manter-original");
const ORIGEM = "portfolio";
const DESTINO = { voz: "notas-voz", comprovativo: "comprovativos", comissao: "comprovativos-comissao" };

const cab = { apikey: SERVICO, Authorization: `Bearer ${SERVICO}` };
const v = (s) => `\x1b[32m${s}\x1b[0m`, x = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;

let movidos = 0, saltados = 0, falhados = 0;
const problemas = [];
const falhar = (o, porque) => { falhados++; problemas.push(`${o} — ${porque}`); console.log(`  ${x("✗")} ${o}\n      ${porque}`); };
const saltar = (o, porque) => { saltados++; console.log(`  ${dim("·")} ${o}\n      ${dim(porque)}`); };

// -------------------------------------------------------------- utilitarios ---
const sql = async (query) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${query.fn}`, {
    method: "POST", headers: { ...cab, "Content-Type": "application/json" }, body: JSON.stringify(query.args ?? {}),
  });
  if (!r.ok) throw new Error(`rpc ${query.fn}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

const tabela = async (caminho, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init, headers: { ...cab, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
};

/** O nome do objecto dentro de `portfolio`, a partir de uma URL publica. Devolve
 *  null se a referencia nao for do `portfolio` -- nao se adivinha. */
const nomeNoPortfolio = (ref) => {
  if (!ref) return null;
  if (!/^https?:\/\//.test(ref)) return null; // ja e um nome: nada a mover
  const m = ref.match(/\/storage\/v1\/object\/public\/portfolio\/(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].split("?")[0]); } catch { return null; }
};

const tipoSemParametros = (tipo, omissao) => (tipo ?? "").split(";")[0].trim() || omissao;

const baixar = async (bucket, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(nome)}`, { headers: cab });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`download ${bucket}/${nome}: HTTP ${r.status}`);
  return { corpo: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get("content-type") };
};

const enviar = async (bucket, nome, corpo, tipo) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(nome)}`, {
    method: "POST", headers: { ...cab, "Content-Type": tipo, "x-upsert": "false" }, body: corpo,
  });
  if (!r.ok) throw new Error(`upload ${bucket}/${nome}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
};

const apagar = async (bucket, nome) => {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(nome)}`, { method: "DELETE", headers: cab });
  if (!r.ok) throw new Error(`apagar ${bucket}/${nome}: HTTP ${r.status}`);
};

/**
 * Copia um objecto para o bucket privado, no MESMO caminho, e confirma que chegou.
 * Nao apaga o original: isso so acontece depois de a base de dados apontar para ca.
 * Devolve "copiado" | "ja-la-estava", ou lanca.
 */
async function copiarParaPrivado(nome, bucketDestino, donoEsperado) {
  const dono = nome.split("/")[0];
  if (!donoEsperado || dono !== donoEsperado) {
    throw new Error(`a 1.ª pasta ("${dono}") nao e o dono esperado ("${donoEsperado}"). ` +
      `Mover assim tirava o ficheiro ao dono: as policies comparam essa pasta com auth.uid().`);
  }

  const fonte = await baixar(ORIGEM, nome);
  if (!fonte) throw new Error(`nao existe em ${ORIGEM} (ja movido a mao? referencia partida?)`);

  const jaLa = await baixar(bucketDestino, nome);
  if (jaLa) {
    if (jaLa.corpo.length !== fonte.corpo.length) {
      throw new Error(`o destino ja tem um ficheiro DIFERENTE neste caminho ` +
        `(${jaLa.corpo.length} vs ${fonte.corpo.length} bytes). Nao se substitui nada.`);
    }
    return "ja-la-estava";
  }

  if (!EXECUTAR) return "copiado";

  const tipo = tipoSemParametros(fonte.tipo, bucketDestino === DESTINO.voz ? "audio/webm" : "image/jpeg");
  await enviar(bucketDestino, nome, fonte.corpo, tipo);

  const confirmado = await baixar(bucketDestino, nome);
  if (!confirmado || confirmado.corpo.length !== fonte.corpo.length) {
    throw new Error(`o que chegou ao destino nao confere (${confirmado?.corpo.length ?? "nada"} vs ${fonte.corpo.length} bytes). Original intacto.`);
  }
  return "copiado";
}

// ------------------------------------------------------------------- vozes ---
async function moverVozes() {
  console.log("\nNotas de voz  portfolio -> notas-voz");
  const pedidos = await tabela(
    "orders?select=id,customer_id,voice_note_url,pickup_voice_note_url" +
    "&or=(voice_note_url.like.http*,pickup_voice_note_url.like.http*)");

  if (!pedidos.length) { console.log(dim("  nada por mover")); return; }

  for (const p of pedidos) {
    for (const col of ["voice_note_url", "pickup_voice_note_url"]) {
      const nome = nomeNoPortfolio(p[col]);
      if (!nome) continue;
      const etiqueta = `${col} do pedido ${p.id.slice(0, 8)}`;
      try {
        const estado = await copiarParaPrivado(nome, DESTINO.voz, p.customer_id);
        if (EXECUTAR) {
          // A base de dados primeiro: enquanto o original existir, uma referencia
          // errada ainda abre. Ao contrario, ficava um pedido sem voz nenhuma.
          // (`orders` so tem triggers `OF status`: mexer na voz nao dispara nada.)
          await tabela(`orders?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ [col]: nome }) });
          if (!MANTER) await apagar(ORIGEM, nome);
        }
        movidos++;
        console.log(`  ${v("✓")} ${etiqueta}${estado === "ja-la-estava" ? dim(" (ja estava no destino)") : ""}`);
        console.log(`      ${dim(nome)}`);
      } catch (e) { falhar(etiqueta, e.message); }
    }
  }
}

// ---------------------------------------------- comprovativos de comissao ---
async function moverComprovativosComissao() {
  console.log("\nComprovativos de comissao  portfolio -> comprovativos-comissao");
  const pagamentos = await tabela("commission_payments?select=id,business_id,proof_url&proof_url=like.http*");
  if (!pagamentos.length) { console.log(dim("  nada por mover")); return; }

  for (const c of pagamentos) {
    const nome = nomeNoPortfolio(c.proof_url);
    const etiqueta = `comprovativo do pagamento ${c.id.slice(0, 8)}`;
    if (!nome) { saltar(etiqueta, `referencia fora do portfolio: ${c.proof_url}`); continue; }
    try {
      const estado = await copiarParaPrivado(nome, DESTINO.comissao, c.business_id);
      if (EXECUTAR) {
        // O trigger `comprovativo_comissao_valido` recusa trocar o comprovativo de
        // um pagamento ja enviado, mas desiste quando `auth.uid()` e nulo -- que e
        // o caso da chave de servico. A troca aqui e a mesma imagem noutro sitio.
        await tabela(`commission_payments?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ proof_url: nome }) });
        if (!MANTER) await apagar(ORIGEM, nome);
      }
      movidos++;
      console.log(`  ${v("✓")} ${etiqueta}${estado === "ja-la-estava" ? dim(" (ja estava no destino)") : ""}`);
      console.log(`      ${dim(nome)}`);
    } catch (e) { falhar(etiqueta, e.message); }
  }
}

// --------------------------------------------- comprovativos de pedido ------
async function moverComprovativosDePedido() {
  console.log("\nComprovativos de pedido LIGADOS  portfolio -> comprovativos");
  const pedidos = await tabela("orders?select=id,customer_id,payment_proof_url&payment_proof_url=like.http*");
  if (!pedidos.length) console.log(dim("  nada por mover"));

  for (const p of pedidos) {
    const nome = nomeNoPortfolio(p.payment_proof_url);
    const etiqueta = `comprovativo do pedido ${p.id.slice(0, 8)}`;
    if (!nome) { saltar(etiqueta, `referencia fora do portfolio: ${p.payment_proof_url}`); continue; }
    try {
      const estado = await copiarParaPrivado(nome, DESTINO.comprovativo, p.customer_id);
      if (EXECUTAR) {
        await tabela(`orders?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ payment_proof_url: nome }) });
        if (!MANTER) await apagar(ORIGEM, nome);
      }
      movidos++;
      console.log(`  ${v("✓")} ${etiqueta}${estado === "ja-la-estava" ? dim(" (ja estava no destino)") : ""}`);
      console.log(`      ${dim(nome)}`);
    } catch (e) { falhar(etiqueta, e.message); }
  }
}

/**
 * Ficheiros SEM linha nenhuma a apontar-lhes. Sao de clientes reais e nao se
 * apagam (§56): mudam de bucket e ficam sem referencia, ao alcance do proprio e
 * do admin.
 *
 * A lista sai do proprio Storage, nao da base de dados -- por definicao nao ha
 * linha que lhes aponte. Por isso o filtro e o CAMINHO que o frontend antigo
 * escrevia, e o dono e a 1.ª pasta.
 *
 *   <uid>/orders/payment/  -> comprovativos   (coluna `payment_proof_url`)
 *   <uid>/orders/voice/    -> notas-voz       (colunas `voice_note_url`, `pickup_…`)
 *
 * `<uid>/chat/voice/` fica FORA a proposito -- ver o cabecalho do ficheiro.
 */
const ORFAOS = [
  {
    nome: "Comprovativos de pedido",
    padrao: /^[0-9a-f-]{36}\/orders\/payment\//,
    destino: () => DESTINO.comprovativo,
    colunas: ["payment_proof_url"],
  },
  {
    nome: "Notas de voz",
    padrao: /^[0-9a-f-]{36}\/orders\/voice\//,
    destino: () => DESTINO.voz,
    colunas: ["voice_note_url", "pickup_voice_note_url"],
  },
];

async function moverOrfaos() {
  console.log("\nORFAOS (sem linha a apontar-lhes)  portfolio -> bucket privado  (movidos, nunca apagados)");

  const lista = await fetch(`${URL_BASE}/storage/v1/object/list/${ORIGEM}`, {
    method: "POST", headers: { ...cab, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000, search: "" }),
  });
  if (!lista.ok) throw new Error(`listagem: HTTP ${lista.status}`);

  // A listagem so devolve um nivel. Desce ate encontrar os ficheiros.
  const ficheiros = [];
  const descer = async (prefixo, fundo) => {
    if (fundo > 6) return;
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/${ORIGEM}`, {
      method: "POST", headers: { ...cab, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: prefixo, limit: 1000, search: "" }),
    });
    if (!r.ok) throw new Error(`listagem "${prefixo}": HTTP ${r.status}`);
    for (const e of await r.json()) {
      const nome = prefixo ? `${prefixo}${e.name}` : e.name;
      if (e.id === null) await descer(`${nome}/`, fundo + 1);
      else ficheiros.push(nome);
    }
  };
  await descer("", 0);

  // Vozes de conversa nao entram aqui, e diz-se porque -- calar era pior.
  const doChat = ficheiros.filter((n) => /^[0-9a-f-]{36}\/chat\/voice\//.test(n));
  for (const nome of doChat) {
    saltar(`voz de chat ${nome.split("/").pop()}`,
      "e mensagem de conversa (messages.content), nao nota de pedido. O bucket " +
      "notas-voz da acesso pelo PEDIDO, nao pela conversa: mover tirava-a a quem " +
      "a recebeu. Precisa de bucket e policy proprios — decisao do dono.");
  }

  let algum = false;
  for (const tipo of ORFAOS) {
    const candidatos = ficheiros.filter((n) => tipo.padrao.test(n));
    if (!candidatos.length) continue;
    algum = true;
    console.log(dim(`  ${tipo.nome} -> ${tipo.destino()}`));

    for (const nome of candidatos) {
      const etiqueta = `orfao ${nome.split("/").pop()}`;
      try {
        // Revalidar AGORA: entre a auditoria e este momento um pedido pode te-lo
        // ligado, e ai ja nao e orfao -- pertence aos ramos de cima, que reescrevem
        // a referencia. Mover aqui deixava o pedido a apontar para o vazio.
        const alvo = encodeURIComponent(nome);
        const condicoes = tipo.colunas.flatMap((c) => [`${c}.eq.${alvo}`, `${c}.like.*${alvo}`]);
        const ligados = await tabela(`orders?select=id&or=(${condicoes.join(",")})`);
        if (ligados.length) {
          saltar(etiqueta, `ja NAO e orfao: ligado ao pedido ${ligados[0].id.slice(0, 8)}. Corre o script outra vez para o tratar como ligado.`);
          continue;
        }

        const estado = await copiarParaPrivado(nome, tipo.destino(), nome.split("/")[0]);
        if (EXECUTAR && !MANTER) await apagar(ORIGEM, nome);
        movidos++;
        console.log(`  ${v("✓")} ${etiqueta}${estado === "ja-la-estava" ? dim(" (ja estava no destino)") : ""}`);
        console.log(`      ${dim(nome)}`);
      } catch (e) { falhar(etiqueta, e.message); }
    }
  }
  if (!algum) console.log(dim("  nada por mover"));
}

// -------------------------------------------------------------------- main ---
async function main() {
  console.log(EXECUTAR
    ? "\x1b[1mMover ficheiros para os buckets privados\x1b[0m"
    : "\x1b[1mSIMULACAO\x1b[0m — nada e alterado. Junta --executar para mover a serio.");
  console.log(dim(`${URL_BASE}${MANTER ? "  (originais mantidos no portfolio)" : ""}`));

  await moverVozes();
  await moverComprovativosDePedido();
  await moverOrfaos();
  await moverComprovativosComissao();

  console.log(`\n${movidos} movidos · ${saltados} saltados · ${falhados} falhados`);
  if (problemas.length) {
    console.log(x("\nPor resolver a mao:"));
    for (const p of problemas) console.log(`  - ${p}`);
  }
  if (!EXECUTAR && (movidos || saltados)) {
    console.log(dim("\nSimulacao. Para mover: node scripts/mover-para-privado.mjs --executar"));
  }
  if (EXECUTAR && !falhados) {
    console.log(v("\nFeito. Confirma no painel que uma voz antiga ainda toca antes de fechares."));
  }
  process.exit(falhados ? 1 : 0);
}

main().catch((e) => { console.error(x(`\nAbortado: ${e.message}`)); process.exit(1); });
