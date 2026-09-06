import {
  Beef, Coffee, Croissant, Sandwich, Store, UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * Ícone de contorno por categoria (§5.3). Contorno e não fotografia: desenha-se
 * de imediato e não custa dados ao utilizador.
 *
 * A chave é o nome em português, tal como está guardado em
 * business_categories.name — é esse valor que também vive em profiles.category.
 *
 * Só as categorias de restauração: a migração 20260906000012 tirou da tabela as
 * de Serviços/Beleza e as de retalho, e manter aqui os ícones delas era guardar
 * o mesmo lixo que causou o problema. Uma categoria nova criada no painel de
 * administrador cai no ícone genérico até alguém a acrescentar a esta lista.
 */
const ICONS: Record<string, LucideIcon> = {
  "Restaurante": UtensilsCrossed,
  "Churrasqueira": Beef,
  "Lanchonete": Sandwich,
  "Pastelaria e Padaria": Croissant,
  "Cafetaria": Coffee,
};

export const getCategoryIcon = (name: string): LucideIcon => ICONS[name] ?? Store;
