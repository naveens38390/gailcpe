/**
 * The drawer: the two destinations, and the theme switch under them.
 *
 * The switch is here rather than on a settings screen because it is the only
 * app-wide preference there is, and the drawer is already the place you go to
 * move between the pricing screens and the Admin Panel.
 */

import { Ionicons } from "@expo/vector-icons";
import {
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from "expo-router/drawer";
import { Pressable, Switch, Text, View } from "react-native";

import { makeStyles, useTheme } from "../context/theme";
import { theme } from "../theme";

export function DrawerContent(props: DrawerContentComponentProps) {
  const styles = useStyles();
  const { colors, mode, scheme, setMode } = useTheme();
  const isDark = scheme === "dark";

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.scroll}>
      <View style={styles.brandBlock}>
        <Text style={styles.brand}>GCPE</Text>
        <Text style={styles.tagline}>GAIL PE competitive pricing</Text>
      </View>

      <View style={styles.items}>
        <DrawerItemList {...props} />
      </View>

      <View style={styles.footer}>
        <View style={styles.switchRow}>
          <Ionicons
            name={isDark ? "moon" : "sunny"}
            size={18}
            color={colors.textMuted}
            style={styles.switchIcon}
          />
          <Text style={styles.switchLabel}>Dark mode</Text>
          <Switch
            value={isDark}
            onValueChange={(next) => setMode(next ? "dark" : "light")}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surfaceCard}
            ios_backgroundColor={colors.border}
          />
        </View>

        {mode === "system" ? (
          <Text style={styles.footNote}>Following your device setting.</Text>
        ) : (
          <Pressable onPress={() => setMode("system")} hitSlop={8}>
            <Text style={styles.footLink}>Follow device setting</Text>
          </Pressable>
        )}
      </View>
    </DrawerContentScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { flexGrow: 1, paddingTop: 0 },
  brandBlock: {
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(4),
    paddingBottom: theme.space(4),
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  brand: {
    color: c.primary,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2,
  },
  tagline: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  items: { paddingTop: theme.space(2) },
  footer: {
    marginTop: "auto",
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(4),
    paddingBottom: theme.space(6),
    borderTopWidth: 1,
    borderTopColor: c.border,
    gap: theme.space(2),
  },
  switchRow: { flexDirection: "row", alignItems: "center" },
  switchIcon: { marginRight: theme.space(2) },
  switchLabel: { color: c.textPrimary, fontSize: 14, fontWeight: "600", flex: 1 },
  footNote: { color: c.textFaint, fontSize: 12 },
  footLink: { color: c.primary, fontSize: 12, fontWeight: "600" },
}));
