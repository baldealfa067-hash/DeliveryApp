export type VerificationStatus = "none" | "pendente" | "aprovado" | "rejeitado";

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "none",
  "pendente",
  "aprovado",
  "rejeitado",
];

import i18n from "@/i18n";

export const verificationLabel = (status: string | null | undefined): string => {
  switch (status) {
    case "aprovado":
      return i18n.t("verification.verified");
    case "pendente":
      return i18n.t("verification.pending");
    case "rejeitado":
      return i18n.t("verification.rejected");
    default:
      return i18n.t("verification.none");
  }
};

export const verificationDescription = (status: string | null | undefined): string => {
  switch (status) {
    case "aprovado":
      return i18n.t("verification.verifiedDesc");
    case "pendente":
      return i18n.t("verification.pendingDesc");
    case "rejeitado":
      return i18n.t("verification.rejectedDesc");
    default:
      return i18n.t("verification.noneDesc");
  }
};

export const isVerifiedStatus = (status: string | null | undefined): boolean =>
  status === "aprovado";

export const canSubmitVerification = (status: string | null | undefined): boolean =>
  status === "none" || status === "rejeitado";