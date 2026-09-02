import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA static files", () => {
  it("includes an offline fallback page", () => {
    expect(existsSync(resolve(process.cwd(), "public", "offline.html"))).toBe(true);
  });

  it("includes a lightweight service worker", () => {
    expect(existsSync(resolve(process.cwd(), "public", "sw.js"))).toBe(true);
  });

  it("only deletes versioned caches owned by this service worker", () => {
    const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf-8");
    expect(source).toContain('key !== STATIC_CACHE && key.startsWith("saba-water-")');
    expect(source).not.toContain("if (key !== STATIC_CACHE) {");
  });

  it("includes a 512px icon for the manifest", () => {
    expect(existsSync(resolve(process.cwd(), "public", "android-icon-512x512.png"))).toBe(true);
  });

  it("includes a maskable icon variant", () => {
    expect(existsSync(resolve(process.cwd(), "public", "maskable-icon-192x192.png"))).toBe(true);
  });
});
