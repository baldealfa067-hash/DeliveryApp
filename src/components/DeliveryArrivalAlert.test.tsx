import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { DeliveryArrivalAlert } from "./DeliveryArrivalAlert";

it("plays the arrival chime once after sound is enabled", async () => {
  sessionStorage.clear();
  const play = vi.fn();
  const oscillator = { frequency: { value: 0 }, connect: vi.fn(), start: play, stop: vi.fn() };
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  oscillator.connect.mockReturnValue(gain);
  vi.stubGlobal("AudioContext", class {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    createOscillator = () => oscillator;
    createGain = () => gain;
  });
  try {
    const view = render(<DeliveryArrivalAlert orderId="order-1" nearby={false} />);
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("orderTracking.arrival.enable") }));
    await screen.findByText(i18n.t("orderTracking.arrival.enabled"));
    expect(play).not.toHaveBeenCalled();
    view.rerender(<DeliveryArrivalAlert orderId="order-1" nearby />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(3));
    view.rerender(<DeliveryArrivalAlert orderId="order-1" nearby={false} />);
    view.rerender(<DeliveryArrivalAlert orderId="order-1" nearby />);
    expect(play).toHaveBeenCalledTimes(3);
    view.unmount();
  } finally {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  }
});
