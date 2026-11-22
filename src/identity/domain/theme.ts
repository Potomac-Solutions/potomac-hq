// Light, dark, or whatever the person's device is set to (issue #2).
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const isTheme = (value: string): value is Theme => (THEMES as readonly string[]).includes(value);

export const THEME_LABELS: { readonly [K in Theme]: string } = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
};
