import { DEFAULT_CONFIG_PATH, formatIssue, validateConfigFile } from '../config/validate.js';

/**
 * @param {string} file
 * @returns {number} process exit code
 */
function main(file) {
  /** @type {import('../config/types.js').ValidationResult} */
  let result;
  try {
    result = validateConfigFile(file);
  } catch (error) {
    console.error(`No se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  for (const warning of result.warnings) console.warn(`advertencia: ${formatIssue(warning)}`);
  for (const error of result.errors) console.error(`error: ${formatIssue(error)}`);

  if (result.ok) {
    console.log(`${file}: configuración válida (${result.config?.productos.length ?? 0} producto(s)).`);
    return 0;
  }
  console.error(`${file}: configuración inválida (${result.errors.length} error(es)).`);
  return 1;
}

process.exitCode = main(process.argv[2] ?? DEFAULT_CONFIG_PATH);
