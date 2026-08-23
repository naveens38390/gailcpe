import { Ionicons } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import { Text, View, type ColorValue } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DrawerContent } from "../components/DrawerContent";
import { LaunchScreen } from "../components/launchScreen";
import { AuthProvider, useAuth } from "../context/auth";
import { AdminGateProvider } from "../context/adminGate";
import { CatalogProvider } from "../context/catalog";
import { NotificationsBadgeProvider, useNotificationsBadge } from "../context/notifications";
import { ThemeProvider, useTheme } from "../context/theme";

/**
 * Startup state, drawn *over* the navigator rather than in place of it.
 *
 * Expo Router mounts routes — and hides the splash screen — only once the root
 * layout renders a navigator. Returning a loading view instead of the <Drawer/>
 * leaves the app on its splash forever, so this is an overlay and the drawer
 * below it is always mounted.
 */
function SessionOverlay() {
  const { loading, error, retry } = useAuth();
  if (!loading && !error) return null;
  return <LaunchScreen status="Opening the price book" error={error} onRetry={retry} />;
}

/** Everything below the providers, so it can read the active theme. */
function AdminIcon({ color, size }: { color: ColorValue; size: number }) {
  const { colors } = useTheme();
  const { unreadCount } = useNotificationsBadge();
  return (
    <View>
      <Ionicons name="construct-outline" color={color} size={size} />
      {unreadCount > 0 ? (
        <View
          style={{
            position: "absolute",
            top: -3,
            right: -6,
            minWidth: 14,
            height: 14,
            borderRadius: 7,
            paddingHorizontal: 2,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.onPrimary, fontSize: 9, fontWeight: "800" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AppShell() {
  const { colors, scheme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgApp }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />

      <Drawer
        drawerContent={(props) => <DrawerContent {...props} />}
        screenOptions={{
          headerShown: false,
          drawerType: "front",
          drawerStyle: { backgroundColor: colors.surfaceCard },
          drawerActiveTintColor: colors.primary,
          drawerActiveBackgroundColor: colors.surfaceAlt,
          drawerInactiveTintColor: colors.textMuted,
          sceneStyle: { backgroundColor: colors.bgApp },
        }}
      >
        <Drawer.Screen
          name="(tabs)"
          options={{
            title: "Pricing",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="podium-outline" color={color} size={size} />
            ),
          }}
        />
        <Drawer.Screen
          name="admin"
          options={{
            title: "Admin Panel",
            drawerIcon: ({ color, size }) => <AdminIcon color={color} size={size} />,
          }}
        />
      </Drawer>

      <SessionOverlay />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <CatalogProvider>
              <NotificationsBadgeProvider>
                <AdminGateProvider>
                  <AppShell />
                </AdminGateProvider>
              </NotificationsBadgeProvider>
            </CatalogProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
