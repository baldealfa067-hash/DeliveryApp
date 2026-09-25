import { useTranslation } from "react-i18next";
import { ContactosEquipa } from "@/components/ContactosEquipa";

/**
 * Contacto com a equipa do iTudoo (2026-09-25). Substitui o chat interno
 * cliente <-> restaurante, removido por decisão do dono: no lugar de
 * "Conversas" na barra de navegação, dois números reais com Ligar e WhatsApp —
 * o mesmo bloco da página /sobre.
 *
 * Aberto sem sessão: quem ainda não tem conta também pode precisar de ajuda.
 */
const ContactPage = () => {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="text-display">{t("teamContact.title")}</h1>
      <p className="mb-6 mt-2 text-body text-muted-foreground">{t("teamContact.intro")}</p>
      <ContactosEquipa />
    </div>
  );
};

export default ContactPage;
