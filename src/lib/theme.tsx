import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * How the app looks: which palette, and how big the text is.
 *
 * Both are written onto the root element as attributes and read by CSS, so switching costs
 * one attribute change and no re-render of anything that draws. `data-mode` travels with
 * `data-theme` because a handful of rules need to know light from dark and cannot work it
 * out from the tokens; it is derived from the theme, never from the system, except when the
 * choice is to follow the system.
 */
export type ThemeId = "paper" | "snow" | "sand" | "slate" | "ink" | "midnight";
export type ThemeChoice = ThemeId | "system";

export interface Theme {
  id: ThemeId;
  mode: "light" | "dark";
  /** The three bands of the swatch: rail, list, reader. */
  swatch: [string, string, string];
  /** The line inside the reader band, so the accent is visible in the miniature. */
  accent: string;
}

export const THEMES: Theme[] = [
  { id: "paper", mode: "light", swatch: ["#1f2b26", "#fdfcfa", "#f7f5f1"], accent: "#2f8a6f" },
  { id: "snow", mode: "light", swatch: ["#1c3547", "#fbfcfd", "#f3f6f8"], accent: "#2d84ac" },
  { id: "sand", mode: "light", swatch: ["#3a4038", "#e5e1d8", "#dcd7cb"], accent: "#3d8560" },
  { id: "slate", mode: "dark", swatch: ["#23272c", "#353a41", "#2e3238"], accent: "#9bdcc3" },
  { id: "ink", mode: "dark", swatch: ["#0f1412", "#16161a", "#131315"], accent: "#8fd8bd" },
  { id: "midnight", mode: "dark", swatch: ["#0a0d13", "#11151d", "#0d1016"], accent: "#8ccbee" },
];

/** What "follow the system" resolves to, in each direction. */
const SYSTEM: Record<"light" | "dark", ThemeId> = { light: "paper", dark: "ink" };

export type TextSize = "small" | "normal" | "large" | "huge";

/** Multiplies every font size in the stylesheet. */
const SCALE: Record<TextSize, number> = { small: 0.92, normal: 1, large: 1.12, huge: 1.26 };

export const TEXT_SIZES: TextSize[] = ["small", "normal", "large", "huge"];

const THEME_KEY = "lumen.theme";
const SIZE_KEY = "lumen.textSize";

interface Appearance {
  choice: ThemeChoice;
  /** The theme actually in force, with "system" resolved. */
  theme: Theme;
  setChoice: (choice: ThemeChoice) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const AppearanceContext = createContext<Appearance | null>(null);

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance outside AppearanceProvider");
  return value;
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    read(THEME_KEY, ["system", ...THEMES.map((t) => t.id)] as const, "system"),
  );
  const [textSize, setTextSizeState] = useState<TextSize>(() =>
    read(SIZE_KEY, TEXT_SIZES, "normal"),
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Only worth watching while the choice is to follow it.
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const theme = useMemo(() => {
    const id = choice === "system" ? SYSTEM[systemDark ? "dark" : "light"] : choice;
    return THEMES.find((t) => t.id === id) ?? THEMES[0];
  }, [choice, systemDark]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.dataset.mode = theme.mode;
    // The scrollbars and form controls the operating system draws follow this, and they
    // look wrong against the wrong palette.
    root.style.colorScheme = theme.mode;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--fs", String(SCALE[textSize]));
  }, [textSize]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    if (next === "system") setSystemDark(systemPrefersDark());
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // A preference is not worth failing over.
    }
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      // Same.
    }
  }, []);

  const value: Appearance = { choice, theme, setChoice, textSize, setTextSize };

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
