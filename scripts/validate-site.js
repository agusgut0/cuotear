/**
 * CI check: builds the site from the On City fixture (fake fetch, temporary
 * directory, no network) and validates every generated page with
 * html-validate and the repository configuration (`.htmlvalidate.json`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPipeline } from '../src/pipeline/run-pipeline.js';
import { htmlProblems } from '../test/helpers/html-validator.js';
import { oncityFetch, runOptions, workspace } from '../test/helpers/pipeline.js';

/**
 * @param {string} directory
 * @returns {string[]} every .html file below the directory
 */
function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : path.endsWith('.html') ? [path] : [];
  });
}

const space = workspace();
await runPipeline({ ...runOptions(space, oncityFetch()), dryRun: true, log: () => {} });

let failed = 0;
const files = htmlFiles(space.outDir);
for (const file of files) {
  const problems = await htmlProblems(readFileSync(file, 'utf8'));
  for (const problem of problems) console.error(`${file}: ${problem}`);
  failed += problems.length;
}
console.log(`validate-site: ${files.length} page(s) checked, ${failed} problem(s)`);
process.exitCode = failed === 0 ? 0 : 1;
