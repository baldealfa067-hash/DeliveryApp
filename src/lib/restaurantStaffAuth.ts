import { normalizePhone } from "@/lib/clientAuth";

export const RESTAURANT_STAFF_PIN_LENGTH = 6;
export const isRestaurantStaffPin = (pin: string) => /^\d{6}$/.test(pin);
export const restaurantStaffCredentials = (phone: string, pin: string) => ({
  email: `r${normalizePhone(phone)}@deliveryapp.gw`,
  password: `DgStaff1!${normalizePhone(phone)}:${pin}`,
});
export const restaurantStaffPhone = (email: string) =>
  /^r([1-9]\d{6,8})@deliveryapp\.gw$/.exec(email)?.[1] ?? null;
