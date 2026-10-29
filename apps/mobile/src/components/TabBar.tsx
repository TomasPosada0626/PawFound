import type { BottomTabBarProps } from "expo-router/js-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthGate } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { totalUnread } from "@/services/selectors";
import { useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";
import { primaryGradient } from "@/theme/tokens";

import { Icon, type IconName } from "./ui/Icon";
import { Text } from "./ui/Text";

const ITEMS: Record<
  string,
  { label: "tabs.home" | "tabs.map" | "tabs.messages" | "tabs.profile"; icon: IconName; active: IconName }
> = {
  index: { label: "tabs.home", icon: "home-outline", active: "home" },
  map: { label: "tabs.map", icon: "map-outline", active: "map" },
  messages: { label: "tabs.messages", icon: "chatbubble-ellipses-outline", active: "chatbubble-ellipses" },
  profile: { label: "tabs.profile", icon: "person-outline", active: "person" },
};

/** Barra flotante del mockup: Inicio, Mapa, (+) Reportar, Mensajes, Perfil. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const backend = useBackendState();
  const requireAccount = useAuthGate();
  const unread = useMemo(() => totalUnread(backend, backend.sessionUserId), [backend]);

  const renderTab = (routeName: string) => {
    const index = state.routes.findIndex((r) => r.name === routeName);
    const route = state.routes[index];
    const item = ITEMS[routeName];
    if (!route || !item) return null;
    const focused = state.index === index;
    const label = t(item.label);
    const showBadge = routeName === "messages" && unread > 0;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={showBadge ? `${label}, ${t("messages.unread", { count: unread })}` : label}
        onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        className="min-h-[56px] flex-1 items-center justify-center gap-0.5 active:opacity-70"
        testID={`tab-${routeName}`}
      >
        <View>
          <Icon name={focused ? item.active : item.icon} size={24} color={focused ? colors.primaryStrong : colors.muted} />
          {showBadge ? (
            <View className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-lost" />
          ) : null}
        </View>
        <Text variant="label" tone={focused ? "primary" : "muted"} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      className="absolute bottom-0 left-0 right-0 px-3"
      style={{ paddingBottom: Math.max(insets.bottom, 10) }}
    >
      <View
        accessibilityRole="tablist"
        className="mx-auto w-full max-w-[560px] flex-row items-end rounded-[28px] border border-border/60 bg-surface px-1 py-1.5 shadow-lg shadow-black/15"
      >
        {renderTab("index")}
        {renderTab("map")}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tabs.report")}
          accessibilityHint={t("tabs.reportHint")}
          onPress={() => {
            if (requireAccount("/report")) router.push("/report");
          }}
          className="-mt-7 flex-1 items-center active:opacity-80"
          testID="tab-report"
        >
          <View className="rounded-full border-4 border-bg shadow-md shadow-black/20">
            <LinearGradient
              colors={primaryGradient}
              style={{ width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="add" size={34} color="#FFFFFF" />
            </LinearGradient>
          </View>
          <Text variant="label" tone="muted" className="mt-0.5">
            {t("tabs.report")}
          </Text>
        </Pressable>
        {renderTab("messages")}
        {renderTab("profile")}
      </View>
    </View>
  );
}
