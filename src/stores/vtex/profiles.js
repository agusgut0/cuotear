/**
 * VTEX store profiles: data, not code (DRT 6.2).
 *
 * `simulacion` enables the optional checkout simulation. On City's robots.txt
 * disallows the checkout routes, so its profile must keep it off; the
 * simulation itself arrives with the Carrefour and Naldo profiles (DRT F3).
 *
 * @typedef {Object} VtexProfile
 * @property {string} id
 * @property {string} displayName
 * @property {string[]} hosts
 * @property {boolean} simulacion
 * @property {'vigente'|'provisional'} status
 */

/** @type {VtexProfile} */
export const oncity = Object.freeze({
  id: 'oncity',
  displayName: 'On City',
  hosts: ['www.oncity.com'],
  simulacion: false,
  status: 'vigente',
});
