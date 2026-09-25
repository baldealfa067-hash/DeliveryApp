import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneInput } from "./PhoneInput";
import { normalizePhone } from "@/lib/clientAuth";

/**
 * O "+245" tem de se VER e de NÃO entrar no valor: o telefone é a identidade da
 * conta, e um prefixo no valor mudava a conta de quem tem número de 7 dígitos.
 */
const Controlado = ({ onValor }: { onValor: (v: string) => void }) => {
  const [v, setV] = useState("");
  return (
    <PhoneInput
      aria-label="telefone"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onValor(e.target.value);
      }}
    />
  );
};

describe("PhoneInput", () => {
  it("mostra o indicativo +245", () => {
    render(<PhoneInput aria-label="telefone" />);
    expect(screen.getByText("+245")).toBeTruthy();
  });

  it("o valor é só o que a pessoa escreveu, sem o indicativo", () => {
    let valor = "";
    render(<Controlado onValor={(v) => (valor = v)} />);
    fireEvent.change(screen.getByLabelText("telefone"), { target: { value: "1234567" } });
    expect(valor).toBe("1234567");
    // A identidade de um número de 7 dígitos fica igual à de antes do prefixo.
    expect(normalizePhone(valor)).toBe("1234567");
  });

  it("continua a ser um campo de telefone", () => {
    render(<PhoneInput aria-label="telefone" />);
    expect(screen.getByLabelText("telefone").getAttribute("type")).toBe("tel");
  });
});
