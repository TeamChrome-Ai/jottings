// Metro must see ../shared, ../data/ccel and ../data/cbd (outside the project root) and resolve the `.js` specifiers
// that shared/*.ts use for ESM (`./books.js` -> books.ts). Only those two data folders: the rest of data/ is large and
// server-side.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const fs = require('fs')

const projectRoot = __dirname
const shared = path.resolve(projectRoot, '../shared')
const ccel = path.resolve(projectRoot, '../data/ccel')
const cbd = path.resolve(projectRoot, '../data/cbd')
const glossary = path.resolve(projectRoot, '..', 'data', 'glossary')
const config = getDefaultConfig(projectRoot)

// BEREAN_NEUTERED=1 (docs/EDITION.md, "Production build"): the bundle carries no 1961 material. src/lib/buildFlags.ts
// resolves to its neutered twin, data/ccel/intro.json to a copy holding only Mr. Darby's own notices (the rule of
// src/lib/editionCore.ts sectionIn1890) and chronology.json to an empty table; the copies are written here, under
// client/.neutered/ (not committed), so one env var is the whole switch. Unset, nothing below is touched.
const neutered = process.env.BEREAN_NEUTERED === '1'
const neuteredDir = path.resolve(projectRoot, '.neutered')
const neuteredFiles = {}
if (neutered) {
  fs.mkdirSync(neuteredDir, { recursive: true })
  const intro = JSON.parse(fs.readFileSync(path.join(ccel, 'intro.json'), 'utf8'))
  const in1890 = t => { const l = t.toLowerCase(); return !l.includes('1961') && !l.startsWith('chronolog') && ['1890', '1884', '1871'].some(y => l.includes(y)) }
  fs.writeFileSync(path.join(neuteredDir, 'intro.json'), JSON.stringify({ sections: intro.sections.filter(s => in1890(s.title)) }))
  fs.writeFileSync(path.join(neuteredDir, 'chronology.json'), JSON.stringify({ title: '', subtitle: '', neutered: true }))
  neuteredFiles[path.join(ccel, 'intro.json')] = path.join(neuteredDir, 'intro.json')
  neuteredFiles[path.join(ccel, 'chronology.json')] = path.join(neuteredDir, 'chronology.json')
  neuteredFiles[path.resolve(projectRoot, 'src/lib/buildFlags.ts')] = path.resolve(projectRoot, 'src/lib/buildFlags.neutered.ts')
}

// BEREAN_WITHOUT_KJV=1, BEREAN_WITHOUT_YLT=1 (docs/LANGUAGES.md, "Leaving a text out"): the bundle carries not a word
// of that Bible and does not offer it. Its own file, src/lib/texts/<id>.ts with its .native twin (the map, the
// version, the chapters), resolves to texts/none.ts, and shared/textsOut.ts, which lists the texts left out, to a copy
// written here under client/.without/ (not committed), since the app cannot read the build's environment where it
// runs. One variable is the whole switch for a text. Unset, nothing below is touched.
const without = ['kjv', 'ylt'].filter(id => process.env[`BEREAN_WITHOUT_${id.toUpperCase()}`] === '1')
const withoutDir = path.resolve(projectRoot, '.without')
const withoutFiles = {}
if (without.length) {
  fs.mkdirSync(withoutDir, { recursive: true })
  fs.writeFileSync(path.join(withoutDir, 'textsOut.ts'), `export const OPTIONAL_TEXTS = ['kjv', 'ylt'] as const\nexport const TEXTS_OUT: readonly string[] = ${JSON.stringify(without)}\n`)
  withoutFiles[path.join(shared, 'textsOut.ts')] = path.join(withoutDir, 'textsOut.ts')
  for (const id of without) for (const twin of ['', '.native']) withoutFiles[path.resolve(projectRoot, `src/lib/texts/${id}${twin}.ts`)] = path.resolve(projectRoot, 'src/lib/texts/none.ts')
}

config.watchFolders = [...(config.watchFolders ?? []), shared, ccel, cbd, glossary, ...(neutered ? [neuteredDir] : []), ...(without.length ? [withoutDir] : [])]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.extraNodeModules = { '@shared': shared }

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@shared/')) {
    moduleName = path.join(shared, moduleName.slice('@shared/'.length))
  }
  if (moduleName.endsWith('.js') && (moduleName.startsWith('.') || moduleName.startsWith('/'))) {
    const base = moduleName.slice(0, -3)
    const from = path.dirname(context.originModulePath)
    const abs = path.resolve(from, base)
    if (!fs.existsSync(abs + '.js') && (fs.existsSync(abs + '.ts') || fs.existsSync(abs + '.tsx'))) moduleName = base
  }
  const res = upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform)
  if (neutered && res && res.type === 'sourceFile' && neuteredFiles[res.filePath]) return { ...res, filePath: neuteredFiles[res.filePath] }
  if (res && res.type === 'sourceFile' && withoutFiles[res.filePath]) return { ...res, filePath: withoutFiles[res.filePath] }
  return res
}

module.exports = config
