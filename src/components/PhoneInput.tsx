import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Campo de telefone com o indicativo da Guiné-Bissau (+245) visível por defeito.
 *
 * O "+245" é um PREFIXO VISUAL, fora do valor do campo, e é de propósito. O
 * telefone é a identidade da conta de cliente: `normalizePhone` deriva dele o
 * email sintético e a password (§8, §48). Se o prefixo entrasse no valor, um
 * número de 7 dígitos passava a "2451234567" — 10 dígitos, que o normalizador
 * não corta — e gerava OUTRA conta, com o cliente a ver "PIN errado" na sua.
 * Quem escrever "+245" à mão continua a funcionar, como antes.
 */
type PhoneInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  /** Classes do invólucro (margens, largura). `className` vai para o campo. */
  wrapperClassName?: string;
};

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, wrapperClassName, ...props }, ref) => (
    <div className={cn("flex items-stretch", wrapperClassName)}>
      <span
        aria-hidden="true"
        className="inline-flex select-none items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-muted-foreground"
      >
        +245
      </span>
      <Input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className={cn("rounded-l-none", className)}
        {...props}
      />
    </div>
  ),
);
PhoneInput.displayName = "PhoneInput";
