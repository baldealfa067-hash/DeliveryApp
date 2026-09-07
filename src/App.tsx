import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import PushPrompt from "./components/PushPrompt";
import PushRepair from "./components/PushRepair";
import RequireAdmin from "./components/RequireAdmin";
import RequireRole from "./components/RequireRole";
import RequireClientArea from "./components/RequireClientArea";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Landing = lazy(() => import("./pages/Landing"));
const Explore = lazy(() => import("./pages/Explore"));
const About = lazy(() => import("./pages/About"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const BusinessDashboard = lazy(() => import("./pages/BusinessDashboard"));
const BusinessEdit = lazy(() => import("./pages/BusinessEdit"));
const BusinessDetail = lazy(() => import("./pages/BusinessDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Models = lazy(() => import("./pages/Models"));
const Profile = lazy(() => import("./pages/Profile"));
const ConversationsPage = lazy(() => import("./pages/ConversationsPage"));
const MyOrdersPage = lazy(() => import("./pages/MyOrdersPage"));
const OrderTrackingPage = lazy(() => import("./pages/OrderTrackingPage"));
const MyAppointmentsPage = lazy(() => import("./pages/MyAppointmentsPage"));
const DriverDashboard = lazy(() => import("./pages/DriverDashboard"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));

const queryClient = new QueryClient();

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

/**
 * A raiz mostrava sempre a Landing, mesmo a quem já tinha sessão iniciada: um
 * cliente que abrisse o site pelo endereço ou pelo ícone da PWA caía na página
 * de marketing e tinha de a atravessar para chegar ao que já é seu. Com sessão
 * vai directo a /inicio; a Landing continua acessível em /landing e volta a ser
 * a raiz assim que a sessão termina. Contas de trabalho nem chegam aqui — o
 * RequireClientArea que envolve esta rota manda-as antes para o seu painel, por
 * ser o destino mais útil, não por lhes estar vedado navegar.
 */
const HomeRoute = () => {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/inicio" replace />;
  return <Landing />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <PushRepair />
            <InstallPrompt />
            <PushPrompt />
            <Routes>
              {/* A raiz escolhe o destino por omissão, não bloqueia nada: quem
                  tem conta de trabalho e abre o site pelo endereço ou pelo
                  ícone da PWA quer quase sempre o seu painel, não a página de
                  marketing. Se quiser navegar como cliente, /inicio, /explorar
                  e /loja/:id estão abertos e alcançáveis a partir do painel.
                  Visitante sem sessão continua a ver a Landing. */}
              <Route path="/" element={<RequireClientArea><HomeRoute /></RequireClientArea>} />
              <Route path="/landing" element={<RequireClientArea><Landing /></RequireClientArea>} />
              <Route path="/sobre" element={<About />} />
              <Route path="/termos" element={<Terms />} />
              <Route path="/privacidade" element={<Privacy />} />
              <Route path="/login" element={<Login />} />
              <Route path="/esqueci-senha" element={<ForgotPassword />} />
              <Route path="/redefinir-senha" element={<ResetPassword />} />
              <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/admin-moderacao" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/models" element={<Models />} />
              {/* Painéis de restaurante fechados ao papel business. A verificação
                  dentro do próprio ecrã chegava tarde: o componente montava e
                  corria as queries antes de redirecionar. */}
              <Route path="/painel-loja" element={<RequireRole roles={["business"]}><BusinessDashboard /></RequireRole>} />
              <Route path="/painel-loja/editar" element={<RequireRole roles={["business"]}><BusinessEdit /></RequireRole>} />
              {/* O painel do motorista fica aberto a quem tem sessão: é aqui que
                  um motorista novo se regista, e sem perfil de motorista o ecrã
                  só mostra esse registo — nenhum dado de entregas. */}
              {/* O destino de recurso é /perfil, e não /painel-loja: uma conta
                  antiga com registo em `drivers` mas sem papel client nem
                  business entrava em ciclo infinito — a área de cliente
                  mandava-a para cá, daqui ia para /painel-loja, de lá para
                  /inicio, e /inicio devolvia-a para cá. Medido: /painel-motorista
                  -> /painel-loja -> /inicio, a repetir sem fim, com o ecrã em
                  branco e sem um único elemento clicável. /perfil não
                  redireciona ninguém de volta para a área de cliente, portanto
                  a cadeia termina sempre. */}
              <Route path="/painel-motorista" element={<RequireRole roles={["client"]} redirectTo="/perfil"><DriverDashboard /></RequireRole>} />
              <Route path="/notificacoes" element={<NotificationsPage />} />
              <Route path="/mensagem/:userId" element={<ChatPage />} />
              <Route element={<Layout />}>
                {/* Início e Explorar são o mesmo ecrã: só existe uma categoria
                    (restaurantes), portanto não há passo intermédio a dar. As duas
                    rotas mantêm-se para não partir links nem marcadores existentes.

                    Sem guarda de tipo de conta, de propósito: navegar e ver
                    menus é conteúdo, não é gestão. Um dono de restaurante ou um
                    motorista tem de poder abrir a app e olhar à volta como
                    qualquer pessoa. O que continua fechado são os painéis de
                    gestão, e esses são guardados por RequireRole. */}
                <Route path="/inicio" element={<Explore />} />
                <Route path="/explorar" element={<Explore />} />
                <Route path="/conversas" element={<ConversationsPage />} />
                {/* Pedir e acompanhar tambem e' area publica: quem faz um
                    pedido tem de o poder ver, seja qual for o tipo de conta.
                    Estiveram fechadas, e uma conta de trabalho conseguia
                    encomendar mas nao conseguia acompanhar o que encomendou.
                    O servidor ja' decidia por posse e nao por tipo:
                    get_customer_orders so' devolve os pedidos de quem os fez, e
                    get_order_history so' abre ao cliente, ao dono do
                    restaurante ou ao motorista da entrega. */}
                <Route path="/meus-pedidos" element={<MyOrdersPage />} />
                <Route path="/pedido/:id" element={<OrderTrackingPage />} />
                <Route path="/meus-agendamentos" element={<MyAppointmentsPage />} />
                <Route path="/perfil" element={<Profile />} />
                {/* Ver o menu de um restaurante é visualização, aberta a
                    qualquer conta — ver o comentário de /inicio. */}
                <Route path="/loja/:id" element={<BusinessDetail />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
