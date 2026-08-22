import { Stack } from "expo-router";

import { theme } from "../../../lib/theme";

/**
 * Master Data Management — a stack nested inside the Admin tab, one screen
 * per entity type (Producers today; Locations, Grades, Discounts, Price
 * Circulars and Freight Circulars follow the same pattern as they're built).
 */
export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.surface },
        headerTintColor: theme.color.text,
        contentStyle: { backgroundColor: theme.color.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Master Data" }} />
      <Stack.Screen name="producers" options={{ title: "Producers" }} />
      <Stack.Screen name="locations" options={{ title: "Locations" }} />
      <Stack.Screen name="grades" options={{ title: "Grades" }} />
      <Stack.Screen name="discounts" options={{ title: "Discount Terms" }} />
      <Stack.Screen name="price-book" options={{ title: "Price Book" }} />
      <Stack.Screen name="price-circulars" options={{ title: "Price Circulars" }} />
      <Stack.Screen name="price-circular/[id]" options={{ title: "Circular" }} />
    </Stack>
  );
}
