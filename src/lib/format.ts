export const formatCFA = (value?: number | null): string => {
  if (value == null) return "";
  return `${value.toLocaleString("pt-PT").replace(/,/g, " ")} CFA`;
};