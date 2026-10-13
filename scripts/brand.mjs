// The brand for the node scripts: shared/brand.ts itself (docs/BRAND.md), so a script names the product, the site and
// the feature's noun the way the app does. Node strips the types but does not know the app's imports, so this
// registers the three rules the bundlers have: `@shared/x` is shared/x, a relative import may leave `.ts` off (or
// say `.js` for a `.ts`), and a JSON file under shared/ is its value. A script that imports the app's own TypeScript
// (client/src/lib/credits.ts, tour.ts) imports this file first and then loads that module with `await import(...)`:
// static imports are resolved before any module runs, which is before the rules are registered.
import { registerHooks } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SHARED = new URL('../shared/', import.meta.url)
const isFile = url => { const p = fileURLToPath(url); return existsSync(p) && statSync(p).isFile() }

registerHooks({
  resolve(specifier, context, next) {
    const local = specifier.startsWith('@shared/') ? new URL(specifier.slice('@shared/'.length), SHARED)
      : (specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/') ? new URL(specifier, context.parentURL)
      : null
    if (local && !isFile(local)) {
      const ts = new URL(local.href.replace(/\.js$/, '') + '.ts')
      if (isFile(ts)) return next(ts.href, context)
    }
    return next(local ? local.href : specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith(SHARED.href) && url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}` }
    return next(url, context)
  },
})

export const { BRAND, NOUN, capitalise, withArticle, possessive, siteUrl, appUrl, SCHEMES } = await import('../shared/brand.ts')
