#!/usr/bin/env node
/**
 * Materialize the engine modules that are not distributed with the repository.
 *
 * `services/core/app/engine/prompt_builder.py` and `rewriter.py` hold the tuned
 * rewrite pipeline and are excluded from version control. Each has a tracked
 * `.template.py` counterpart implementing the same public interface. This script
 * copies a template into place only when the real module is absent, so running
 * it against a working tree that already has the tuned modules is a no-op.
 *
 * Run automatically by CI and by `npm run bootstrap:engine` after a fresh clone.
 */

import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const modules = [
  "services/core/app/engine/prompt_builder.py",
  "services/core/app/engine/rewriter.py",
];

const rubrics = [
  "services/core/app/engine/rubrics/plain_language_map.json",
];

let materialized = 0;
let skipped = 0;

for (const target of modules) {
  const targetPath = join(repoRoot, target);
  const templatePath = targetPath.replace(/\.py$/, ".template.py");

  if (existsSync(targetPath)) {
    console.log(`present  ${target}`);
    skipped += 1;
    continue;
  }
  if (!existsSync(templatePath)) {
    console.error(`missing template for ${target}`);
    process.exit(1);
  }
  copyFileSync(templatePath, targetPath);
  console.log(`created  ${target} (from template)`);
  materialized += 1;
}

// Rubrics fall back at load time rather than needing a copy, so this is only a
// visibility check. The scorer reads the `.example.json` seed when the
// maintained file is absent.
for (const target of rubrics) {
  const targetPath = join(repoRoot, target);
  const examplePath = targetPath.replace(/\.json$/, ".example.json");
  if (existsSync(targetPath)) {
    console.log(`present  ${target}`);
  } else if (existsSync(examplePath)) {
    console.log(`fallback ${target} not found, scorer will use the example seed`);
  } else {
    console.error(`missing both ${target} and its example seed`);
    process.exit(1);
  }
}

console.log(
  `\nEngine bootstrap complete. ${materialized} module(s) created from template, ${skipped} already present.`
);
if (materialized > 0) {
  console.log(
    "Templates are reference implementations. They are safe and correct but " +
      "converge more slowly than the tuned pipeline."
  );
}
