/**
 * How much of the screen the keyboard is covering.
 *
 * A bottom-anchored sheet and an open keyboard want the same part of the
 * screen, and the sheet does not find out about the keyboard on its own. On
 * Android a React Native `Modal` is its own window, so the activity's
 * `adjustResize` never reaches it: the sheet keeps its full height, the
 * keyboard draws over the lower half, and the results the user typed to find
 * are underneath it. From the user's side the search simply lost them.
 *
 * So the covered height is measured and handed back, for a sheet to keep clear
 * of. Returns 0 when no keyboard is up, which is also what it returns on a
 * desktop browser and on any platform that cannot tell us.
 */

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") {
      // The layout viewport does not shrink for the on-screen keyboard, which
      // is the same reason `100vh` is wrong on a phone browser. The visual
      // viewport does, so the difference between the two is the keyboard.
      const viewport: any =
        typeof window !== "undefined" ? (window as any).visualViewport : undefined;
      if (!viewport) return;
      const measure = () =>
        setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
      measure();
      viewport.addEventListener("resize", measure);
      viewport.addEventListener("scroll", measure);
      return () => {
        viewport.removeEventListener("resize", measure);
        viewport.removeEventListener("scroll", measure);
      };
    }

    // iOS announces the keyboard before it animates, so the sheet can travel
    // with it instead of jumping afterwards. Android only fires the `did`
    // events, and firing on `will` there would measure a keyboard that has not
    // finished appearing.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) =>
      setInset(event.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(hideEvent, () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}
