/**
 * Theme state, shared across the app.
 *
 * Three modes: follow the device (`system`), or pin to `light` / `dark`. The
 * choice is written to AsyncStorage so the app opens the way it was left —
 * an officer who set dark mode on site does not get a white screen tomorrow.
 *
 * Screens never read a hex value. They call `useTheme()` for one-off colours
 * and `makeStyles()` for stylesheets, both of which follow the active scheme.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { Colors, type ColorSchemeName, type ThemeColors } from "../constants/colors";

const STORAGE_KEY = "gcpe.themeMode";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
  /** What the user picked. */
  mode: ThemeMode;
  /** What that resolves to right now, once the device is taken into account. */
  scheme: ColorSchemeName;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  /** Flips between light and dark, pinning the result (never back to system). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function isMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const deviceScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  // Read the stored preference once. Until it lands the app follows the
  // device, which is the same thing the majority of users would have chosen.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isMode(stored)) setModeState(stored);
      })
      .catch(() => {
        // A preference that cannot be read is not worth interrupting anyone over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorSchemeName =
    mode === "system" ? (deviceScheme === "dark" ? "dark" : "light") : mode;

  const toggle = useCallback(() => {
    setMode(scheme === "dark" ? "light" : "dark");
  }, [scheme, setMode]);

  const value = useMemo(
    () => ({ mode, scheme, colors: Colors[scheme], setMode, toggle }),
    [mode, scheme, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

/** Just the colours, for the common case. */
export function useColors(): ThemeColors {
  return useTheme().colors;
}

/** Mirrors React Native's own StyleSheet.create constraint, so style values keep their literal types. */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * The stylesheet equivalent of `useColors`.
 *
 * `StyleSheet.create` copies its values, so a stylesheet built at module load
 * can never follow a theme change. This builds one per scheme instead, caches
 * it, and hands back the right one — so screens keep the familiar
 * `styles.card` shape while still repainting when the theme flips.
 *
 *   const useStyles = makeStyles((c) => ({ card: { backgroundColor: c.surfaceCard } }));
 *   function Screen() {
 *     const styles = useStyles();
 *   }
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & NamedStyles<any>,
): () => T {
  const cache = new Map<ColorSchemeName, T>();
  return function useStyles(): T {
    const { scheme, colors } = useTheme();
    let sheet = cache.get(scheme);
    if (!sheet) {
      sheet = StyleSheet.create(factory(colors));
      cache.set(scheme, sheet);
    }
    return sheet;
  };
}
