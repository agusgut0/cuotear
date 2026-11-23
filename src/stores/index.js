import { checkVtexProductUrl } from './url.js';
import { createVtexStore } from './vtex/adapter.js';
import { oncity } from './vtex/profiles.js';

/**
 * Registration of a store adapter (DRT 6.1).
 * @typedef {Object} StoreRegistration
 * @property {string} id key used in `productos[].urls`
 * @property {string} displayName
 * @property {string[]} hosts exact hosts allowed for this store
 * @property {'vigente'|'provisional'} status
 * @property {(url: URL) => import('./url.js').UrlCheck} validateUrl
 * @property {(ctx: import('../http/client.js').FetchContext, url: string, options: import('./types.js').MeasureOptions) => Promise<import('./types.js').StoreResult>} measure
 * @property {(url: URL) => string[]} captureUrls requests that `npm run fixtures:capture` makes for a product URL
 */

/**
 * Single place to touch when adding a store (DRT section 3).
 * @type {readonly StoreRegistration[]}
 */
export const stores = [createVtexStore(oncity, checkVtexProductUrl)];
