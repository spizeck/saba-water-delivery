import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA static files", () => {
  it("includes an offline fallback page", () => {
    expect(existsSync(resolve(process.cwd(), "public", "offline.html"))).toBe(true);
  });

  it("includes a lightweight service worker", () => {
    expect(existsSync(resolve(process.cwd(), "public", "sw.js"))).toBe(true);
  });

  it("includes a 512px icon for the manifest", () => {
    expect(existsSync(resolve(process.cwd(), "public", "android-icon-512x512.png"))).toBe(true);
  });

  it("includes a maskable icon variant", () => {
    expect(existsSync(resolve(process.cwd(), "public", "maskable-icon-192x192.png"))).toBe(true);
  });
});
