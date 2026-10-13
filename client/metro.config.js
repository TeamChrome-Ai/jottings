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

config.watchFolders = [...(config.watchFolders ?? []), shared, ccel, cbd, glossary, ...(neutered ? [neuteredDir] : [])]
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
  return res
}

module.exports = config
