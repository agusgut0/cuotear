import { checkVtexProductUrl } from './url.js';

/**
 * Registration of a store adapter. Only the fields needed to validate the
 * configuration exist for now; `measure` arrives with the adapters (DRT 6.1).
 * @typedef {Object} StoreRegistration
 * @property {string} id key used in `productos[].urls`
 * @property {string} displayName
 * @property {string[]} hosts exact hosts allowed for this store
 * @property {'vigente'|'provisional'} status
 * @property {(url: URL) => import('./url.js').UrlCheck} validateUrl
 */

/**
 * Single place to touch when adding a store (DRT section 3).
 * @type {readonly StoreRegistration[]}
 */
export const stores = [
  {
    id: 'oncity',
    displayName: 'On City',
    hosts: ['www.oncity.com'],
    status: 'vigente',
    validateUrl: checkVtexProductUrl,
  },
];
