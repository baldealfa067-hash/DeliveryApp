export const LOCATIONS: { group: string; options: string[] }[] = [
  {
    group: "Bairros de Bissau",
    options: [
      "Bandim",
      "Bairro Militar",
      "Pluba",
      "Antula",
      "Mindará",
      "Belém",
      "Santa Luzia",
      "Cupelum",
      "Cuntum",
      "Chapa de Bissau",
      "Centro / Praça",
    ],
  },
];

export const LOCATION_OPTIONS = LOCATIONS.flatMap((g) => g.options);

export const BAIRROS_FILTER = ["Todos os Bairros", ...LOCATIONS[0].options];