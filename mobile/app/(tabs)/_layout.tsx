import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../lib/auth";
import { theme } from "../../lib/theme";

const CAN_SEE_CORRECTIONS = [
  "territory_manager",
  "regional_manager",
  "corporate_pricing",
  "admin",
];

/**
 * The MVP screens. Comparison sits first because it is the question the app
 * exists to answer; Deal is next because it is what the officer does about it.
 * Corrections is hidden from Sales Officers — they can see a gap but neither
 * propose nor approve closing it, so the tab would only ever 403 for them.
 */
export default function TabsLayout() {
  const { user } = useAuth();
  const showCorrections = CAN_SEE_CORRECTIONS.includes(user?.role ?? "");

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.surface },
        headerTintColor: theme.color.text,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
        },
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.textFaint,
        sceneStyle: { backgroundColor: theme.color.bg },
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
          href: showCorrections ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="create-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Master Data",
          href: showCorrections ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="server-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
