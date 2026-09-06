import {
  Beef, Cpu, Coffee, Croissant, Fish, Footprints, Ham, Pill, Sandwich, Scissors,
  Shirt, ShoppingBasket, ShoppingCart, Smartphone, Store, UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * Ícone de contorno por categoria (§5.3). Contorno e não fotografia: desenha-se
 * de imediato e não custa dados ao utilizador.
 *
 * A chave é o nome em português, tal como está guardado em
 * business_categories.name — é esse valor que também vive em profiles.category.
 * Categorias novas caem no ícone genérico até alguém as acrescentar aqui.
 */
const ICONS: Record<string, LucideIcon> = {
  "Restaurante": UtensilsCrossed,
  "Churrasqueira": Beef,
  "Lanchonete": Sandwich,
  "Pastelaria e Padaria": Croissant,
  "Cafetaria": Coffee,
  "Mercearia": ShoppingBasket,
  "Supermercado": ShoppingCart,
  "Talho": Ham,
  "Peixaria": Fish,
  "Loja de Roupa": Shirt,
  "Loja de Calçado": Footprints,
  "Loja de Eletrónica": Cpu,
  "Loja de Telemóveis": Smartphone,
  "Cabeleireiro e Salão": Scissors,
  "Farmácia": Pill,
};

export const getCategoryIcon = (name: string): LucideIcon => ICONS[name] ?? Store;
