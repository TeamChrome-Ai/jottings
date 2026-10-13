/**
 * What this build of the app carries (docs/EDITION.md, "Production build"). The default build carries both editions'
 * data and follows the server. A build made with BEREAN_NEUTERED=1 is resolved to buildFlags.neutered.ts instead
 * (client/metro.config.js): it carries no 1961 notes, notice or table and no Coates, shows the 1890 credits, and takes
 * the cleanse as on until the server says otherwise.
 */
export const NEUTERED = false
