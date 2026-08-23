import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { DrawerToggleButton } from "expo-router/drawer";

import { useTheme } from "../../context/theme";

/**
 * The pricing screens. Comparison sits first because it is the question the
 * app exists to answer; Deal is next because it is what the officer does about
 * it. Master data lives in the Admin Panel, one level up in the drawer.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceCard },
        headerTintColor: colors.textPrimary,
        headerLeft: () => <DrawerToggleButton tintColor={colors.textPrimary} />,
        tabBarStyle: {
          backgroundColor: colors.surfaceCard,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.bgApp },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Compare",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="podium-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="deal"
        options={{
          title: "Deal",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calculator-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: "Grades",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="freight"
        options={{
          title: "Freight",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="car-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="circulars"
        options={{
          title: "Circulars",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="corrections"
        options={{
          title: "Corrections",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="create-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
