import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isIOSSafari, isStandaloneDisplay } from "../platform";

describe("platform detection", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: "" } as unknown as Navigator);
    vi.stubGlobal("document", { ontouchend: undefined } as unknown as Document);
    vi.stubGlobal("window", { matchMedia: vi.fn() } as unknown as Window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects iOS Safari from user agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" } as unknown as Navigator);
    expect(isIOSSafari()).toBe(true);
  });

  it("does not flag Android Chrome as iOS", () => {
    vi.stubGlobal(
      "navigator",
      {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      } as unknown as Navigator,
    );
    expect(isIOSSafari()).toBe(false);
  });

  it("detects standalone display mode", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("window", { matchMedia } as unknown as Window);
    expect(isStandaloneDisplay()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(display-mode: standalone)");
  });

  it("detects iPad Pro user agent with touch support", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 5 } as unknown as Navigator);
    vi.stubGlobal("document", { ontouchend: true } as unknown as Document);
    vi.stubGlobal("window", { matchMedia: vi.fn() } as unknown as Window);
    expect(isIOSSafari()).toBe(true);
  });
});
