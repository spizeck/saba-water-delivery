import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readManifest(name: string) {
  const filePath = resolve(process.cwd(), "public", name);
  return JSON.parse(readFileSync(filePath, "utf-8")) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
  };
}

describe("PWA manifests", () => {
  it("root manifest declares standalone display and a 512 icon with maskable support", () => {
    const manifest = readManifest("manifest.json");

    expect(manifest.name).toBe("Saba Water Delivery");
    expect(manifest.short_name).toBe("Water Delivery");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBeDefined();
    expect(manifest.background_color).toBeDefined();

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("512x512");
    expect(sizes).toContain("192x192");

    const maskables = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskables.length).toBeGreaterThanOrEqual(1);
  });

  it("driver manifest starts at /driver and uses the same theme", () => {
    const manifest = readManifest("driver-manifest.json");
    expect(manifest.start_url).toBe("/driver");
    expect(manifest.scope).toBe("/driver");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#0ea5e9");
  });

  it("resident manifest starts at /resident and uses the same theme", () => {
    const manifest = readManifest("resident-manifest.json");
    expect(manifest.start_url).toBe("/resident");
    expect(manifest.scope).toBe("/resident");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#0ea5e9");
  });
});
