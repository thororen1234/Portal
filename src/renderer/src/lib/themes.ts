export type ThemeId = 'dark' | 'oled' | 'midnight' | 'forest' | 'crimson' | 'light'

export interface Theme {
  id: ThemeId
  label: string

  swatch: [string, string, string]

  titleBar: { color: string; symbolColor: string }
}

export const THEMES: Theme[] = [
  {
    id: "dark",
    label: "Dark",
    swatch: ["#000000", "#1e1e1e", "#d6d6d6"],
    titleBar: {
      color: "#000000",
      symbolColor: "#a6a6a6",
    },
  },
  {
    id: "oled",
    label: "OLED",
    swatch: ["#000000", "#0d0d0d", "#ffffff"],
    titleBar: {
      color: "#000000",
      symbolColor: "#8a8a8a",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: ["#0b1020", "#1a2342", "#8fb0ff"],
    titleBar: {
      color: "#0b1020",
      symbolColor: "#a3acc7",
    },
  },
  {
    id: "forest",
    label: "Forest",
    swatch: ["#0a120d", "#16241b", "#7fd6a0"],
    titleBar: {
      color: "#0a120d",
      symbolColor: "#9db8a6",
    },
  },
  {
    id: "crimson",
    label: "Crimson",
    swatch: ["#120a0c", "#271519", "#ff8a9b"],
    titleBar: {
      color: "#120a0c",
      symbolColor: "#c2a0a6",
    },
  },
  {
    id: "light",
    label: "Light",
    swatch: ["#f4f5f7", "#ffffff", "#2a2f38"],
    titleBar: {
      color: "#ffffff",
      symbolColor: "#4a4f59",
    },
  },
];

export const THEME_IDS = THEMES.map((theme) => theme.id)

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id
  const theme = THEMES.find((candidate) => candidate.id === id) ?? THEMES[0]
  void window.portal.setTitleBarColors(theme.titleBar).catch(() => undefined)
}
