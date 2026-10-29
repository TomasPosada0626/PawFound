import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Modal, View } from "react-native";

import { BADGE_RULES, newlyEarned, tiersOf, type BadgeId } from "@/domain/badges";
import { useI18n } from "@/i18n/I18nProvider";
import { userBadgeProgress } from "@/services/selectors";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useBackendState } from "@/store/backend";

import { BadgeHex, tierLabelKey } from "./badges";
import { PawDecoration } from "./brand";
import { Button } from "./ui/Button";
import { Text } from "./ui/Text";

type Seen = { userId: string; tiers: Partial<Record<BadgeId, number>> };

/**
 * Celebra cada insignia nueva o nivel nuevo, una a la vez. Lo ya visto se guarda por cuenta
 * en el dispositivo; la primera vez que se abre una cuenta no se celebra lo que ya tenía.
 */
export function BadgeCelebration() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const userId = state.sessionUserId;
  const progress = useMemo(() => (userId ? userBadgeProgress(state, userId) : []), [state, userId]);
  const [seen, setSeen] = useState<Seen | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const key = `${STORAGE_KEYS.badgesSeen}.${userId}`;
    void readJSON<Seen["tiers"]>(key).then((saved) => {
      if (!alive) return;
      const tiers = saved ?? tiersOf(userBadgeProgress(backend.getSnapshot(), userId));
      if (!saved) void writeJSON(key, tiers);
      setSeen({ userId, tiers });
    });
    return () => {
      alive = false;
    };
  }, [backend, userId]);

  const pending = seen && seen.userId === userId ? newlyEarned(seen.tiers, progress) : [];
  const current = pending[0];

  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!current) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const name = t(`badges.${current.id}`);
    AccessibilityInfo.announceForAccessibility(t("badgesHow.celebrateAnnounce", { name, tier: t(tierLabelKey(current.tier)) }));
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((reduce) => {
        if (cancelled || reduce) return;
        scale.setValue(0.4);
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [current, scale, t]);

  if (!current || !seen || !userId) return null;

  const dismiss = (then?: () => void) => {
    const tiers = { ...seen.tiers, [current.id]: current.tier };
    setSeen({ userId, tiers });
    void writeJSON(`${STORAGE_KEYS.badgesSeen}.${userId}`, tiers);
    then?.();
  };

  const multiTier = BADGE_RULES[current.id].thresholds.length > 1;
  const goal = BADGE_RULES[current.id].thresholds[current.tier - 1] ?? 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => dismiss()} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View
          accessibilityViewIsModal
          className="w-full max-w-[380px] items-center overflow-hidden rounded-[32px] bg-surface px-6 pb-6 pt-8"
          testID="badge-celebration"
        >
          <PawDecoration size={110} opacity={0.1} className="absolute -left-6 -top-4" />
          <PawDecoration size={80} opacity={0.08} className="absolute -right-3 top-24" />
          <Text variant="label" tone="primary" className="uppercase">
            {multiTier && current.tier > 1
              ? t("badgesHow.celebrateLevelUp", { tier: t(tierLabelKey(current.tier)) })
              : t("badgesHow.celebrateTitle")}
          </Text>
          <Animated.View style={{ transform: [{ scale }], marginVertical: 18 }}>
            <BadgeHex id={current.id} tier={current.tier} size={132} />
          </Animated.View>
          <Text variant="title" className="text-center" accessibilityRole="header">
            {t(`badges.${current.id}`)}
          </Text>
          {multiTier ? (
            <Text variant="captionStrong" className="mt-1 text-center">
              {t(tierLabelKey(current.tier))}
            </Text>
          ) : null}
          <Text variant="body" className="mt-2 text-center">
            {t(`badgesHow.${current.id}`, { count: goal })}
          </Text>
          <View className="mt-6 w-full gap-2">
            <Button label={t("badgesHow.celebrateCta")} onPress={() => dismiss()} testID="badge-celebration-ok" />
            <Button
              label={t("badgesHow.celebrateSee")}
              variant="ghost"
              onPress={() => dismiss(() => router.push({ pathname: "/profile", params: { badges: "open" } }))}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
