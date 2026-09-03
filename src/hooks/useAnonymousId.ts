import { useState } from "react";

const ANON_ID_KEY = "bornaal_anonymous_id";

function generateId(): string {
  return "anon-" + crypto.randomUUID();
}

export const useAnonymousId = () => {
  const [anonymousId] = useState<string>(() => {
    try {
      const existing = localStorage.getItem(ANON_ID_KEY);
      if (existing) return existing;
      const newId = generateId();
      localStorage.setItem(ANON_ID_KEY, newId);
      return newId;
    } catch {
      return generateId();
    }
  });

  return anonymousId;
};
