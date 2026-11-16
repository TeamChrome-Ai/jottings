/**
 * The Bibles left out of this build (docs/LANGUAGES.md, "Leaving a text out"): `BEREAN_WITHOUT_KJV=1` leaves out the
 * King James Version, `BEREAN_WITHOUT_YLT=1` Young's Literal Translation. Each is one switch for the whole of a build:
 * the data build (rs/src/db.rs `text_left_out`), the app's bundle and the web app.
 *
 * Node reads the variables here (the tests, scripts/credits-html.mjs). The app's bundler cannot read them where the
 * app runs, so client/metro.config.js resolves this file to a copy it writes with the same answer.
 */
export const OPTIONAL_TEXTS = ['kjv', 'ylt'] as const
const env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
export const TEXTS_OUT: readonly string[] = OPTIONAL_TEXTS.filter(id => env[`BEREAN_WITHOUT_${id.toUpperCase()}`] === '1')
