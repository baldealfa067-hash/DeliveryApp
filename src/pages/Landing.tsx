import { isStandalone } from "@/lib/push";
import EntryScreen from "@/components/landing/EntryScreen";
import MarketingLanding from "@/components/landing/MarketingLanding";

/**
 * O que vê quem chega SEM sessão, em dois comportamentos (pedido do dono,
 * 2026-09-25):
 *
 * - pelo BROWSER (site): a landing de marketing, que explica o que é o iTudoo
 *   e convida a instalar a app;
 * - pela APP INSTALADA (modo standalone da PWA): o ecrã simples de entrar —
 *   quem instalou já sabe o que é, e abre a app para a usar.
 *
 * Quem tem sessão nunca chega aqui: o HomeRoute manda-o para /inicio, e o
 * RequireClientArea manda as contas de trabalho para o seu painel.
 */
const Landing = () => (isStandalone() ? <EntryScreen /> : <MarketingLanding />);

export default Landing;
