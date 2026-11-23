import { readFileSync } from 'node:fs';
import { HtmlValidate } from 'html-validate';

/**
 * html-validate with the repository configuration (`.htmlvalidate.json`).
 * @returns {HtmlValidate}
 */
export const repoHtmlValidator = () => new HtmlValidate(JSON.parse(readFileSync(new URL('../../.htmlvalidate.json', import.meta.url), 'utf8')));

/**
 * @param {string} page
 * @returns {Promise<string[]>} `rule: message` for every finding
 */
export async function htmlProblems(page) {
  const report = await repoHtmlValidator().validateString(page);
  return report.results.flatMap((result) => result.messages.map((message) => `${message.ruleId}: ${message.message} (line ${message.line})`));
}
