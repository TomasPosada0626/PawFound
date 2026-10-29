import { useMemo, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";

import { LogoMark } from "@/components/brand";
import { SettingsCard, SettingsLayout } from "@/components/SettingsLayout";
import { Button } from "@/components/ui/Button";
import { Divider, IconBubble, ListRow, type IconTone } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { LEGAL_URLS, SUPPORT_EMAIL } from "@/config";
import { useI18n } from "@/i18n/I18nProvider";
import { foldText } from "@/services/selectors";
import { useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const FAQ: { n: 1 | 2 | 3 | 4 | 5 | 6 | 7; icon: IconName }[] = [
  { n: 1, icon: "paw-outline" },
  { n: 2, icon: "radio-button-on" },
  { n: 3, icon: "people-outline" },
  { n: 6, icon: "heart-outline" },
  { n: 7, icon: "warning-outline" },
  { n: 4, icon: "shield-checkmark-outline" },
  { n: 5, icon: "chatbubbles-outline" },
];

type ContactKind = "reportUser" | "reportBug" | "contactSupport" | "suggestion";

const CONTACT: { kind: ContactKind; icon: IconName; tone: IconTone }[] = [
  { kind: "reportUser", icon: "flag-outline", tone: "danger" },
  { kind: "reportBug", icon: "bug-outline", tone: "warning" },
  { kind: "contactSupport", icon: "headset-outline", tone: "violet" },
  { kind: "suggestion", icon: "bulb-outline", tone: "blue" },
];

/** Ayuda y soporte. Funciona también sin cuenta: pedir ayuda nunca debe requerir login. */
export default function SupportScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const user = useCurrentUser();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [contact, setContact] = useState<ContactKind | null>(null);
  const [message, setMessage] = useState("");

  const faqs = useMemo(() => {
    const q = foldText(query.trim());
    return FAQ.filter(
      ({ n }) => !q || foldText(`${t(`support.q${n}`)} ${t(`support.q${n}d`)} ${t(`support.a${n}`)}`).includes(q),
    );
  }, [query, t]);

  const content = (
    <>
      <SettingsCard title={t("support.howHelp")}>
        <View className="min-h-[48px] flex-row items-center gap-2 rounded-2xl border border-border px-3">
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel={t("support.searchPlaceholder")}
            placeholder={t("support.searchPlaceholder")}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 font-regular text-[14px] text-ink"
            testID="faq-search"
          />
        </View>
      </SettingsCard>

      <SettingsCard title={t("support.faq")}>
        {faqs.length === 0 ? <Text variant="caption">{t("support.noResults", { query })}</Text> : null}
        {faqs.map(({ n, icon }, i) => {
          const expanded = open === n;
          return (
            <View key={n}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={t(`support.q${n}`)}
                onPress={() => setOpen(expanded ? null : n)}
                className="min-h-[56px] flex-row items-center gap-3 py-3 active:opacity-70"
                testID={`faq-${n}`}
              >
                <IconBubble icon={icon} size={40} />
                <View className="flex-1">
                  <Text variant="bodyStrong">{t(`support.q${n}`)}</Text>
                  <Text variant="caption">{t(`support.q${n}d`)}</Text>
                </View>
                <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
              </Pressable>
              {expanded ? (
                <Text variant="body" className="mb-3 ml-[52px]" accessibilityLiveRegion="polite">
                  {t(`support.a${n}`)}
                </Text>
              ) : null}
            </View>
          );
        })}
      </SettingsCard>

      <SettingsCard title={t("support.contact")}>
        {CONTACT.map((c, i) => (
          <View key={c.kind}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              icon={c.icon}
              tone={c.tone}
              title={t(`support.${c.kind}`)}
              description={t(`support.${c.kind}Desc`)}
              right={
                c.kind === "contactSupport" ? (
                  <View className="rounded-full bg-primary-soft px-2 py-1">
                    <Text variant="label" tone="primary">
                      {t("support.response24")}
                    </Text>
                  </View>
                ) : undefined
              }
              onPress={() => setContact(c.kind)}
              testID={`contact-${c.kind}`}
            />
          </View>
        ))}
      </SettingsCard>

      <SettingsCard title={t("support.important")}>
        <ListRow
          icon="document-text-outline"
          tone="neutral"
          title={t("support.terms")}
          description={t("support.termsDesc")}
          onPress={() => void Linking.openURL(LEGAL_URLS.terms)}
        />
        <Divider />
        <ListRow
          icon="lock-closed-outline"
          tone="neutral"
          title={t("support.privacyPolicy")}
          description={t("support.privacyPolicyDesc")}
          onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}
        />
        <Divider />
        <ListRow
          icon="people-outline"
          tone="neutral"
          title={t("support.guidelines")}
          description={t("support.guidelinesDesc")}
          onPress={() => void Linking.openURL(LEGAL_URLS.guidelines)}
        />
      </SettingsCard>

      <View className="flex-row items-center gap-3 rounded-3xl bg-primary-soft p-4">
        <LogoMark size={44} />
        <View className="flex-1">
          <Text variant="bodyStrong" tone="primary">
            {t("support.hereForYou")}
          </Text>
          <Text variant="caption" tone="body">
            {t("support.hereForYouBody")}
          </Text>
        </View>
      </View>

      <Sheet
        visible={contact !== null}
        onClose={() => setContact(null)}
        title={contact ? t(`support.${contact}`) : ""}
        subtitle={t("support.formTitle")}
      >
        <TextField
          label={t("support.formTitle")}
          placeholderText={t("support.formPlaceholder")}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={1000}
          showCounter
          testID="support-message"
        />
        <Text variant="caption" className="mt-3">
          {t("support.viaEmail", { email: SUPPORT_EMAIL })}
        </Text>
        <View className="mb-2 mt-4">
          <Button
            label={t("support.send")}
            icon="mail-outline"
            disabled={message.trim().length < 10}
            onPress={() => {
              // Abre la app de correo con el mensaje listo: así de verdad le llega al equipo.
              const subject = `PawFound · ${contact ? t(`support.${contact}`) : ""}`;
              const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message.trim())}`;
              void Linking.openURL(url)
                .then(() => {
                  setContact(null);
                  setMessage("");
                })
                .catch(() => toast(t("support.noMailApp", { email: SUPPORT_EMAIL }), "error"));
            }}
            testID="support-send"
          />
        </View>
      </Sheet>
    </>
  );

  return (
    <SettingsLayout section="help" title={t("settings.help")} showLogout={Boolean(user)}>
      {content}
    </SettingsLayout>
  );
}
