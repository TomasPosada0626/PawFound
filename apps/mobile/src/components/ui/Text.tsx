import { Text as RNText, type TextProps } from "react-native";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export type TextVariant =
  "display" | "title" | "heading" | "subheading" | "body" | "bodyStrong" | "caption" | "captionStrong" | "label";

export type TextTone = "ink" | "body" | "muted" | "primary" | "lost" | "found" | "white" | "danger" | "warning" | "verified";

const VARIANT: Record<TextVariant, string> = {
  display: "font-nunito-black text-[30px] leading-[36px]",
  title: "font-nunito-extrabold text-2xl leading-8",
  heading: "font-nunito-extrabold text-lg leading-6",
  subheading: "font-nunito-bold text-base leading-6",
  body: "font-regular text-[15px] leading-[22px]",
  bodyStrong: "font-nunito-bold text-[15px] leading-[22px]",
  caption: "font-regular text-[13px] leading-[18px]",
  captionStrong: "font-nunito-bold text-[13px] leading-[18px]",
  label: "font-nunito-bold text-xs leading-4",
};

const DEFAULT_TONE: Record<TextVariant, TextTone> = {
  display: "ink",
  title: "ink",
  heading: "ink",
  subheading: "ink",
  body: "body",
  bodyStrong: "ink",
  caption: "muted",
  captionStrong: "ink",
  label: "body",
};

const TONE: Record<TextTone, string> = {
  ink: "text-ink",
  body: "text-body",
  muted: "text-muted",
  primary: "text-primary-strong",
  lost: "text-lost-ink",
  found: "text-found-ink",
  white: "text-white",
  danger: "text-danger",
  warning: "text-warning",
  verified: "text-verified",
};

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Solo clases de layout (márgenes, alineación); color y tamaño van por variant/tone. */
  className?: string;
};

/** Texto tipográfico de la app. Respeta el tamaño de fuente del sistema (sp). */
export function Text({ variant = "body", tone, className, ...props }: AppTextProps) {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      className={cn(VARIANT[variant], TONE[tone ?? DEFAULT_TONE[variant]], className)}
      {...props}
    />
  );
}
