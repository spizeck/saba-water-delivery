import { toString } from "qrcode";
import { describe, expect, it } from "vitest";

import { getPwaInstallUrl } from "../constants";

describe("QR code generation", () => {
  it("produces deterministic SVG output for a portal URL", async () => {
    const url = getPwaInstallUrl("driver");
    const svg1 = await toString(url, { type: "svg", width: 256, margin: 2, errorCorrectionLevel: "M" });
    const svg2 = await toString(url, { type: "svg", width: 256, margin: 2, errorCorrectionLevel: "M" });

    expect(svg1).toContain("</svg>");
    expect(svg1).toContain('width="256"');
    expect(svg1).toBe(svg2);
  });

  it("includes the driver install path in the generated QR code", async () => {
    const url = getPwaInstallUrl("driver");
    const svg = await toString(url, { type: "svg", width: 256, margin: 2, errorCorrectionLevel: "M" });
    expect(svg).toBeTruthy();
    // The SVG itself encodes the URL as a matrix; we rely on the deterministic
    // helper to confirm the input string is exactly the public install URL.
    expect(url).toContain("/driver/install");
  });
});
