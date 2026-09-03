import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useCustomerAppointments, type Appointment } from "@/hooks/useAppointments";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";

const APPT_STATUS_LABELS: Record<string, { key: string; color: string }> = {
  solicitado: { key: "appointmentStatus.requested", color: "bg-blue-100 text-blue-800" },
  confirmado: { key: "appointmentStatus.confirmed", color: "bg-green-100 text-green-800" },
  em_atendimento: { key: "appointmentStatus.inProgress", color: "bg-yellow-100 text-yellow-800" },
  concluido: { key: "appointmentStatus.completed", color: "bg-green-100 text-green-800" },
  avaliado: { key: "appointmentStatus.reviewed", color: "bg-purple-100 text-purple-800" },
  cancelado: { key: "appointmentStatus.cancelled", color: "bg-red-100 text-red-800" },
};

const MyAppointmentsPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: appointments = [], isLoading } = useCustomerAppointments(user?.id ?? null);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Calendar className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">{t("myAppointments.loginRequired")}</p>
          <Button onClick={() => navigate("/login")} className="mt-4">
            {t("auth.login")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-20">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">{t("myAppointments.title")}</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && appointments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-primary/50" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t("myAppointments.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("myAppointments.emptyHint")}</p>
          <Button onClick={() => navigate("/explorar")} className="mt-4" variant="outline">
            {t("myAppointments.browseSalons")}
          </Button>
        </div>
      )}

      {!isLoading && appointments.length > 0 && (
        <div className="flex flex-col gap-3">
          {appointments.map((apt) => {
            const statusInfo = APPT_STATUS_LABELS[apt.status] ?? { key: apt.status, color: "bg-gray-100 text-gray-800" };
            return (
              <Card key={apt.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Scissors className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-bold">{apt.service_name}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo.color}`}>
                          {t(statusInfo.key)}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate">{apt.business_name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(apt.appointment_date).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {apt.appointment_time.slice(0, 5)}
                        </span>
                      </div>
                      {apt.service_price != null && (
                        <p className="text-sm font-bold text-primary mt-1">{formatCFA(apt.service_price)}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyAppointmentsPage;
