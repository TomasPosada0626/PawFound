import * as Sentry from "@sentry/react-native";

import { startMonitoring } from "../monitoring";

describe("monitoreo de errores", () => {
  beforeEach(() => jest.mocked(Sentry.init).mockClear());

  it("sin DSN no envía nada", () => {
    expect(startMonitoring("")).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("nunca envía datos personales", () => {
    expect(startMonitoring("https://k@sentry.test/1")).toBe(true);
    const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options?.sendDefaultPii).toBe(false);
    const event = options?.beforeSend?.(
      { user: { email: "a@b.co" }, request: { method: "GET", url: "https://x/chat/1", data: "secreto" } } as never,
      {} as never,
    ) as { user?: unknown; request?: unknown };
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ method: "GET" });
    expect(options?.beforeBreadcrumb?.({ category: "http" }, {} as never)).toBeNull();
    expect(options?.beforeBreadcrumb?.({ category: "navigation" }, {} as never)).toBeNull();
    expect(options?.beforeBreadcrumb?.({ category: "console" }, {} as never)).toEqual({ category: "console" });
  });
});
