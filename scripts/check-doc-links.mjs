#!/usr/bin/env node
/**
 * Repo-local Markdown link checker (issue #51).
 *
 * Validates every internal link in the repository's tracked Markdown files:
 *   - relative file links resolve to a file that exists;
 *   - `#anchor` fragments (same-file or `file.md#anchor`) match a heading in the
 *     target file (GitHub-style slug).
 *
 * Deliberately small and dependency-free (plain Node, like the other
 * `scripts/*.mjs`): it never touches the network, so external `http(s)://` and
 * `mailto:`/`tel:` links are skipped. Deterministic; exits 1 with actionable
 * output when anything is broken, 0 otherwise. Run with `npm run docs:check-links`.
 *
 * Not wired into `npm run check`/CI by this change to keep that scope
 * documentation-only; wiring it into the `verify` workflow is a reasonable
 * follow-up.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

const files = execSync("git ls-files *.md **/*.md", { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);
// De-duplicate (the two globs can overlap for nested files).
const mdFiles = [...new Set(files)];

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** GitHub-style heading slug (lowercase, punctuation stripped, spaces → hyphens). */
function slug(text) {
  return text
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

// Build the set of heading anchors for each file.
const anchors = new Map();
for (const file of mdFiles) {
  const set = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = HEADING_RE.exec(line);
    if (m) set.add(slug(m[2]));
  }
  anchors.set(file, set);
}

const problems = [];
for (const file of mdFiles) {
  const dir = dirname(file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(line)) !== null) {
      let target = m[1].trim();
      // Drop an optional link title: [x](path "title").
      if (!target.startsWith("<")) target = target.split(/\s+/)[0];
      if (/^(https?:|mailto:|tel:|#!)/.test(target)) continue;

      const [rawPath, frag] = target.split("#");
      // Pure external protocol-relative or empty → skip.
      if (rawPath === "" && !frag) continue;

      // Resolve the target file (git uses forward slashes).
      const targetFile =
        rawPath === ""
          ? file
          : normalize(join(dir, rawPath)).split(sep).join("/");

      if (rawPath !== "" && !anchors.has(targetFile)) {
        // Not a tracked .md — check the path exists on disk (a file OR a
        // directory; linking to a source folder like `src/lib/logging` is valid).
        if (!existsSync(join(dir, rawPath))) {
          problems.push(`${file}:${idx + 1}  missing file → ${target}`);
        }
        continue;
      }
      if (
        frag &&
        anchors.has(targetFile) &&
        !anchors.get(targetFile).has(slug(frag))
      ) {
        problems.push(`${file}:${idx + 1}  missing anchor → ${target}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`[check-doc-links] ${problems.length} broken link(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `[check-doc-links] OK — ${mdFiles.length} Markdown files, no broken internal links.`,
);
