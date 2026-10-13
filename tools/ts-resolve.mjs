// Lets node run the repo's TypeScript tools directly (node strips the types): shared/ imports its siblings as './x.js'
// (the bundlers' convention), which here resolves to the .ts beside it. Usage: node --import ./tools/ts-resolve.mjs tools/x.ts
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('/'))) {
      const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context)
    }
    return next(specifier, context)
  },
})
