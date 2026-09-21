import { describe, it, expect } from "vitest";
import i18n from "./index";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pt from "./locales/pt.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import kri from "./locales/kri.json";
import kriPorTraduzir from "./kri-por-traduzir.json";
import semFicheiro from "./chaves-sem-ficheiro.json";

/**
 * Guarda das traducoes (Fase 9.5).
 *
 * Existe por causa de uma falha real: tres ecras da Fase 2.3/2.4 foram
 * convertidos para `t("fleetCash.…")` sem que o namespace chegasse a ser criado
 * em ficheiro nenhum. Nao rebentou nada — o i18next cai em silencio para o NOME
 * da chave, e o utilizador via `fleetCash.statePending` escrito no ecra. O
 * `tsc`, o `eslint` e os testes estavam todos verdes por cima disso.
 *
 * O contador de cobertura tambem nao apanhava: ele conta as chaves que existem,
 * e o problema era precisamente nao existirem.
 *
 * O Kriol esta incompleto DE PROPOSITO — os ecras do Bornaal e os textos com
 * valor legal (Termos, Privacidade) ficam de fora ate haver revisao de falante
 * nativo. Por isso nao se exige paridade: exige-se que a divida NAO CRESCA.
 * `kri-por-traduzir.json` e essa linha de base, e so pode encolher. Uma chave
 * nova escrita sem Kriol falha aqui.
 */

type Arvore = { [k: string]: unknown };

const achatar = (o: Arvore, prefixo = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? achatar(v as Arvore, `${prefixo}${k}.`)
      : [`${prefixo}${k}`],
  );

const tem = (o: Arvore, chave: string): boolean => {
  let cur: unknown = o;
  for (const parte of chave.split(".")) {
    if (cur === null || typeof cur !== "object" || !(parte in (cur as Arvore))) return false;
    cur = (cur as Arvore)[parte];
  }
  return true;
};

const IDIOMAS: Record<string, Arvore> = { pt, en, fr, kri };

/** Uma chave e algo como `namespace.chave`, em camelCase. Exclui `select("id, name")`. */
const PARECE_CHAVE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

const ficheirosFonte = (dir: string): string[] =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return ficheirosFonte(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });

/** Chaves escritas a letra no codigo: `t("x.y")` e o padrao `chave: "x.y"`. */
const chavesUsadas = (): Map<string, string> => {
  const encontradas = new Map<string, string>();
  for (const f of ficheirosFonte("src")) {
    const s = readFileSync(f, "utf-8");
    const padroes = [/(?<![\w.])t\(\s*"([^"]+)"/g, /chave:\s*"([^"]+)"/g];
    for (const p of padroes) {
      for (const m of s.matchAll(p)) {
        if (PARECE_CHAVE.test(m[1]) && !encontradas.has(m[1])) encontradas.set(m[1], f);
      }
    }
  }
  return encontradas;
};

describe("traducoes", () => {
  it("toda a chave usada no codigo existe em pt, en e fr", () => {
    const usadas = chavesUsadas();
    expect(usadas.size).toBeGreaterThan(100); // o scanner encontrou mesmo alguma coisa
    const conhecidas = new Set(semFicheiro as string[]);

    const faltam: string[] = [];
    for (const [chave, ficheiro] of usadas) {
      if (conhecidas.has(chave)) continue;
      for (const lang of ["pt", "en", "fr"] as const) {
        if (!tem(IDIOMAS[lang], chave)) faltam.push(`${lang}: ${chave}  (${ficheiro})`);
      }
    }
    expect(faltam).toEqual([]);
  });

  it("a lista de chaves sem ficheiro so encolhe", () => {
    // Estas chaves nao existem em idioma nenhum: o codigo passa-lhes um texto
    // por omissao em portugues, que aparece igual em ingles e em frances.
    //
    // NAO se resolvem so acrescentando a chave: `driverDashboard.goingToCustomer`
    // e `goingToRestaurant` sao usadas em DOIS sitios com defaults diferentes
    // ("A caminho do cliente" e "Ir ao cliente"). Criar a chave mudava o texto
    // de um dos dois em silencio — e decisao de conteudo, nao de traducao.
    const jaExistem = (semFicheiro as string[]).filter((k) => tem(pt as Arvore, k));
    expect(jaExistem).toEqual([]);
  });

  it("nenhuma chave NOVA entra sem Kriol", () => {
    const base = new Set(kriPorTraduzir as string[]);
    const novas: string[] = [];
    for (const [chave, ficheiro] of chavesUsadas()) {
      if (!tem(kri as Arvore, chave) && !base.has(chave)) {
        novas.push(`${chave}  (${ficheiro})`);
      }
    }
    // Se falhar: traduza a chave para Kriol. So se acrescenta a linha de base
    // uma chave que o dono do projecto decidiu NAO traduzir (texto legal).
    expect(novas).toEqual([]);
  });

  it("a linha de base do Kriol so encolhe — o que ja esta traduzido sai dela", () => {
    const jaTraduzidas = (kriPorTraduzir as string[]).filter((k) => tem(kri as Arvore, k));
    // Se falhar: apague estas chaves de `kri-por-traduzir.json`. Deixa-las la
    // faria a divida parecer maior do que e, e escondia uma regressao futura.
    expect(jaTraduzidas).toEqual([]);
  });

  it("pt, en e fr tem exactamente o mesmo conjunto de chaves", () => {
    const base = new Set(achatar(pt as Arvore));
    for (const lang of ["en", "fr"] as const) {
      const outro = new Set(achatar(IDIOMAS[lang] as Arvore));
      const emFalta = [...base].filter((k) => !outro.has(k));
      const aMais = [...outro].filter((k) => !base.has(k));
      expect({ lang, emFalta, aMais }).toEqual({ lang, emFalta: [], aMais: [] });
    }
  });

  it("o i18next devolve mesmo o array dos dias, nao o nome da chave", async () => {
    // O teste acima olha para o JSON. Este exercita a instancia a serio: se
    // `returnObjects` nao funcionasse, `t` devolvia a string "businessHours.days"
    // e o ecra mostrava `undefined` em cada dia, sem erro nenhum.
    for (const lang of ["pt", "en", "fr", "kri"] as const) {
      await i18n.changeLanguage(lang);
      const dias = i18n.t("businessHours.days", { returnObjects: true }) as string[];
      expect(Array.isArray(dias)).toBe(true);
      expect({ lang, n: dias.length }).toEqual({ lang, n: 7 });
      expect(typeof dias[0]).toBe("string");
    }
    await i18n.changeLanguage("pt");
  });

  it("os nomes dos dias sao 7, e por ordem indexavel por weekday", () => {
    // `BusinessHoursEditor` le isto com `returnObjects` e indexa por
    // `p.weekday` (0 = domingo), que e o que o backend guarda. Um array com
    // outro tamanho dava `undefined` no ecra, sem erro.
    for (const [lang, dados] of Object.entries(IDIOMAS)) {
      const dias = (dados as { businessHours: { days: string[] } }).businessHours.days;
      expect({ lang, n: dias.length }).toEqual({ lang, n: 7 });
      expect(dias.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    }
  });
});
