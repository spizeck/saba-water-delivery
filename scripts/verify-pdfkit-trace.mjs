#!/usr/bin/env node
/**
 * Lightweight post-build guard for the PDFKit/Vercel packaging issue.
 *
 * pdfkit is externalized in `next.config.ts` (`serverExternalPackages`)
 * so its runtime font/color assets are discovered relative to its real
 * package directory. Next's output-file tracing must copy those assets
 * into the deployment bundle for every server entry point that can reach
 * a PDFKit renderer.
 *
 * This script inspects the `.nft.json` trace files after `next build` and
 * fails if any entry that references pdfkit is missing either the
 * `js/data/` or `js/standard-fonts/` trees.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const outputDir = process.env.NEXT_OUTPUT_DIR || ".next";
const serverDir = join(outputDir, "server");

if (!existsSync(serverDir)) {
  console.error(`[verify-pdfkit-trace] Server output directory not found: ${serverDir}`);
  console.error("Run `npm run build` first.");
  process.exit(1);
}

/** Recursively collect .nft.json files under `dir`. */
function collectNftFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectNftFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
      result.push(path);
    }
  }
  return result;
}

const normalized = (p) => p.split(sep).join("/");

const nftFiles = collectNftFiles(serverDir);
if (nftFiles.length === 0) {
  console.error("[verify-pdfkit-trace] No .nft.json files found.");
  process.exit(1);
}

const requiredTrees = [
  { name: "data", pattern: /node_modules\/pdfkit\/js\/data\// },
  { name: "standard-fonts", pattern: /node_modules\/pdfkit\/js\/standard-fonts\// },
];

const pdfkitConsumers = [];
const failures = [];

for (const nftPath of nftFiles) {
  const nft = JSON.parse(readFileSync(nftPath, "utf8"));
  if (!Array.isArray(nft.files)) continue;

  const files = nft.files.map((f) => normalized(String(f)));
  const referencesPdfkit = files.some((f) => f.includes("node_modules/pdfkit/"));
  if (!referencesPdfkit) continue;

  const entry = nftPath.replace(/\.nft\.json$/, "");
  pdfkitConsumers.push(entry);

  for (const { name, pattern } of requiredTrees) {
    if (!files.some((f) => pattern.test(f))) {
      failures.push(`${entry}: missing pdfkit js/${name}/ tree`);
    }
  }
}

if (pdfkitConsumers.length === 0) {
  console.warn("[verify-pdfkit-trace] No server bundles reference pdfkit. If PDF routes exist, this may be a tracing regression.");
}

if (failures.length > 0) {
  console.error("[verify-pdfkit-trace] PDFKit trace incomplete:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(`[verify-pdfkit-trace] Checked ${nftFiles.length} trace files, ${pdfkitConsumers.length} pdfkit consumers.`);
  process.exit(1);
}

console.log(`[verify-pdfkit-trace] OK. Checked ${nftFiles.length} trace files, ${pdfkitConsumers.length} pdfkit consumers all include data/ and standard-fonts/.`);
