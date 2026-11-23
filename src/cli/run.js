import { parseArgs } from 'node:util';
import { runPipeline } from '../pipeline/run-pipeline.js';

/**
 * `node src/cli/run.js [--dry-run] [--out <dir>] [--config <file>] [--state <file>] [--data <dir>]`
 *
 * Exit code: 0 even when stores fail or are blocked (RNF-12); 1 when the
 * configuration is invalid and there is no previous valid one, or on an
 * unexpected internal error (a bug).
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      config: { type: 'string' },
      state: { type: 'string' },
      data: { type: 'string' },
    },
  });

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const { exitCode } = await runPipeline({
    dryRun: values['dry-run'],
    ...(values.out === undefined ? {} : { outDir: values.out }),
    ...(values.config === undefined ? {} : { configPath: values.config }),
    ...(values.state === undefined ? {} : { statePath: values.state }),
    ...(values.data === undefined ? {} : { dataDir: values.data }),
    ...(summaryFile === undefined || summaryFile === '' ? {} : { summaryFile }),
  });
  return exitCode;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`::error::cuotear: unexpected internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
}
