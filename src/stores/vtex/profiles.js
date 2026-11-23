/**
 * VTEX store profiles: data, not code (DRT 6.2).
 *
 * `simulacion` enables the optional checkout simulation. It is NOT implemented
 * (the spike showed it adds no cash discount over the catalog, DRT 6.2), so every
 * profile keeps it off; On City's robots.txt also disallows the checkout routes.
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

/** @type {VtexProfile} */
export const carrefour = Object.freeze({
  id: 'carrefour',
  displayName: 'Carrefour',
  hosts: ['www.carrefour.com.ar'],
  simulacion: false,
  status: 'vigente',
});

/** @type {VtexProfile} */
export const naldo = Object.freeze({
  id: 'naldo',
  displayName: 'Naldo',
  hosts: ['www.naldo.com.ar'],
  simulacion: false,
  status: 'provisional',
});
