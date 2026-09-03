import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import PushPrompt from "./components/PushPrompt";
import PushRepair from "./components/PushRepair";
import RequireAdmin from "./components/RequireAdmin";
import { Loader2 } from "lucide-react";

const Landing = lazy(() => import("./pages/Landing"));
const Index = lazy(() => import("./pages/Index"));
const Explore = lazy(() => import("./pages/Explore"));
const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
const About = lazy(() => import("./pages/About"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ProviderDashboard = lazy(() => import("./pages/ProviderDashboard"));
const BusinessDashboard = lazy(() => import("./pages/BusinessDashboard"));
const BusinessEdit = lazy(() => import("./pages/BusinessEdit"));
const BusinessDetail = lazy(() => import("./pages/BusinessDetail"));
const BeautyDashboard = lazy(() => import("./pages/BeautyDashboard"));
const BeautyEdit = lazy(() => import("./pages/BeautyEdit"));
const BeautyDetail = lazy(() => import("./pages/BeautyDetail"));
const Requests = lazy(() => import("./pages/Requests"));
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

const HomeRoute = () => <Landing />;

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
              <Route path="/" element={<HomeRoute />} />
              <Route path="/landing" element={<Landing />} />
              <Route path="/sobre" element={<About />} />
              <Route path="/termos" element={<Terms />} />
              <Route path="/privacidade" element={<Privacy />} />
              <Route path="/login" element={<Login />} />
              <Route path="/esqueci-senha" element={<ForgotPassword />} />
              <Route path="/redefinir-senha" element={<ResetPassword />} />
              <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/admin-moderacao" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/models" element={<Models />} />
              <Route path="/painel" element={<ProviderDashboard />} />
              <Route path="/painel-loja" element={<BusinessDashboard />} />
              <Route path="/painel-loja/editar" element={<BusinessEdit />} />
              <Route path="/painel-beleza" element={<BeautyDashboard />} />
              <Route path="/painel-beleza/editar" element={<BeautyEdit />} />
              <Route path="/painel-motorista" element={<DriverDashboard />} />
              <Route path="/notificacoes" element={<NotificationsPage />} />
              <Route path="/mensagem/:userId" element={<ChatPage />} />
              <Route element={<Layout />}>
                <Route path="/inicio" element={<Index />} />
                <Route path="/explorar" element={<Explore />} />
                <Route path="/conversas" element={<ConversationsPage />} />
                <Route path="/meus-pedidos" element={<MyOrdersPage />} />
                <Route path="/pedido/:id" element={<OrderTrackingPage />} />
                <Route path="/meus-agendamentos" element={<MyAppointmentsPage />} />
                <Route path="/pedidos" element={<Requests />} />
                <Route path="/perfil" element={<Profile />} />
                <Route path="/prestador/:id" element={<ProviderDetail />} />
                <Route path="/loja/:id" element={<BusinessDetail />} />
                <Route path="/beleza/:id" element={<BeautyDetail />} />
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
