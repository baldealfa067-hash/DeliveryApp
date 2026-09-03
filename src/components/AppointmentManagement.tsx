import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  CheckCircle2,
  Loader2,
  XCircle,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useBusinessAppointments, useUpdateAppointmentStatus, type Appointment } from "@/hooks/useAppointments";
import { useTranslation } from "react-i18next";
import { formatCFA } from "@/lib/format";

const APPT_STATUS_TABS = [
  { value: "solicitado", label: "appointmentStatus.requested", icon: Calendar, color: "text-blue-600" },
  { value: "confirmado", label: "appointmentStatus.confirmed", icon: CheckCircle2, color: "text-green-600" },
  { value: "em_atendimento", label: "appointmentStatus.inProgress", icon: Scissors, color: "text-yellow-600" },
  { value: "concluido", label: "appointmentStatus.completed", icon: CheckCircle2, color: "text-green-600" },
  { value: "cancelado", label: "appointmentStatus.cancelled", icon: XCircle, color: "text-red-600" },
];

const NEXT_STATUS: Record<string, string[]> = {
  solicitado: ["confirmado", "cancelado"],
  confirmado: ["em_atendimento", "cancelado"],
  em_atendimento: ["concluido"],
  concluido: [],
  avaliado: [],
  cancelado: [],
};

interface AppointmentManagementProps {
  businessId: string;
}

const AppointmentManagement = ({ businessId }: AppointmentManagementProps) => {
  const { t } = useTranslation();
  const { data: allAppointments = [], isLoading, refetch } = useBusinessAppointments(businessId);
  const updateStatus = useUpdateAppointmentStatus();
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  const getAppointmentsByStatus = (status: string) =>
    allAppointments.filter((a) => a.status === status);

  const handleStatusChange = async (appointmentId: string, newStatus: string) => {
    try {
      await updateStatus.mutateAsync({ appointmentId, newStatus });
    } catch (err) {
      console.error("[appointment] status update error:", err);
    }
  };

  return (
    <div>
      <Tabs defaultValue="solicitado">
        <TabsList className="w-full justify-start overflow-x-auto h-auto p-1 bg-muted/50">
          {APPT_STATUS_TABS.map((tab) => {
            const count = getAppointmentsByStatus(tab.value).length;
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="gap-1.5 text-xs data-[state=active]:bg-background"
              >
                <Icon className={`h-3.5 w-3.5 ${tab.color}`} />
                {t(tab.label)}
                {count > 0 && (
                  <Badge className="ml-1 h-4 min-w-[16px] text-[9px] px-1">{count}</Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {APPT_STATUS_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : getAppointmentsByStatus(tab.value).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("appointmentManagement.noAppointments")}
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-3">
                {getAppointmentsByStatus(tab.value).map((apt) => (
                  <AppointmentCard
                    key={apt.id}
                    appointment={apt}
                    onView={() => {
                      setSelectedAppointment(apt);
                      setDetailOpen(true);
                    }}
                    onStatusChange={(newStatus) => handleStatusChange(apt.id, newStatus)}
                    nextStatuses={NEXT_STATUS[apt.status] ?? []}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          {selectedAppointment && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Scissors className="h-5 w-5 text-primary" />
                  {selectedAppointment.service_name}
                </DialogTitle>
                <DialogDescription>
                  {new Date(selectedAppointment.appointment_date).toLocaleDateString()} · {selectedAppointment.appointment_time.slice(0, 5)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t("appointmentManagement.customer")}</p>
                  <p className="text-sm font-medium">{selectedAppointment.customer_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedAppointment.customer_phone}</p>
                </div>

                {selectedAppointment.service_price != null && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{t("common.price")}</p>
                    <p className="text-sm font-bold">{formatCFA(selectedAppointment.service_price)}</p>
                  </div>
                )}

                {selectedAppointment.notes && (
                  <div className="p-2 bg-muted/50 rounded-lg">
                    <p className="text-xs font-medium text-muted-foreground">{t("appointmentManagement.notes")}</p>
                    <p className="text-sm mt-0.5">{selectedAppointment.notes}</p>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-row gap-2 flex-wrap">
                {NEXT_STATUS[selectedAppointment.status]?.map((newStatus) => (
                  <Button
                    key={newStatus}
                    size="sm"
                    variant={newStatus === "cancelado" ? "destructive" : "default"}
                    onClick={() => {
                      setDetailOpen(false);
                      handleStatusChange(selectedAppointment.id, newStatus);
                    }}
                    disabled={updateStatus.isPending}
                  >
                    {t(`appointmentStatus.${newStatus}`, newStatus)}
                  </Button>
                ))}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const AppointmentCard = ({
  appointment,
  onView,
  onStatusChange,
  nextStatuses,
}: {
  appointment: Appointment;
  onView: () => void;
  onStatusChange: (status: string) => void;
  nextStatuses: string[];
}) => {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold">{appointment.service_name}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(appointment.appointment_date).toLocaleDateString()} · {appointment.appointment_time.slice(0, 5)}
              </span>
            </div>
            <p className="text-sm font-medium">{appointment.customer_name}</p>
            <p className="text-xs text-muted-foreground">{appointment.customer_phone}</p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button size="sm" variant="outline" onClick={onView} className="gap-1">
              {t("common.view")}
            </Button>
            {nextStatuses.length > 0 && nextStatuses[0] !== "cancelado" && (
              <Button
                size="sm"
                onClick={() => onStatusChange(nextStatuses[0])}
                className="gap-1"
              >
                {t(`appointmentStatus.${nextStatuses[0]}`, nextStatuses[0])}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AppointmentManagement;
