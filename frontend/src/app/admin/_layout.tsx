import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { DrawerToggleButton } from "expo-router/drawer";
import { Pressable, View } from "react-native";

import { AdminLock } from "../../components/adminLock";
import { useAdminGate } from "../../context/adminGate";
import { useTheme } from "../../context/theme";

/**
 * The Admin Panel — its own drawer destination, separate from the pricing
 * screens, with one stack screen per entity type. Everything here writes to
 * master data, so it is kept out of the day-to-day tab bar.
 */
export default function AdminLayout() {
  const { colors } = useTheme();
  const { unlocked, lock } = useAdminGate();
  return (
    <View style={{ flex: 1 }}>
      <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceCard },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.bgApp },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Admin Panel",
          headerLeft: () => <DrawerToggleButton tintColor={colors.textPrimary} />,
          headerRight: () =>
            unlocked ? (
              <Pressable onPress={lock} hitSlop={12} style={{ paddingHorizontal: 12 }}>
                <Ionicons name="lock-open-outline" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null,
        }}
      />
      <Stack.Screen name="producers" options={{ title: "Producers" }} />
      <Stack.Screen name="locations" options={{ title: "Locations" }} />
      <Stack.Screen name="grades" options={{ title: "Grades" }} />
      <Stack.Screen name="discounts" options={{ title: "Discount Terms" }} />
      <Stack.Screen name="price-book" options={{ title: "Price Book" }} />
      <Stack.Screen name="price-circulars" options={{ title: "Price Circulars" }} />
      <Stack.Screen name="price-circular/[id]" options={{ title: "Circular" }} />
      </Stack>

      {unlocked ? null : <AdminLock />}
    </View>
  );
}
