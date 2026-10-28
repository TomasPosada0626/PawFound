import "../global.css";

import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from "@expo-google-fonts/nunito";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { AppProviders } from "@/AppProviders";
import { BackgroundServices } from "@/components/BackgroundServices";
import { BadgeCelebration } from "@/components/BadgeCelebration";
import { useTheme } from "@/theme/ThemeProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="report/index" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="report/success" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="pet/[id]/sighting" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="alerta/angel/[id]" options={{ animation: "slide_from_bottom" }} />
      </Stack>
      <BackgroundServices />
      <BadgeCelebration />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  // Si las fuentes fallan, se sigue con la del sistema en vez de bloquear la app.
  if (!loaded && !error) return null;

  return (
    <AppProviders>
      <RootStack />
    </AppProviders>
  );
}
