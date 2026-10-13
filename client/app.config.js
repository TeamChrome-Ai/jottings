// The Expo config: app.json holds everything that is not the brand (and `version` / `android.versionCode`, which the
// release tools read from it as text); the brand's part is put in here from ../shared/brand.json (docs/BRAND.md):
// the name and slug, the link schemes, the package and bundle ids, the host of the links the app opens, the web
// name, the two permission sentences that name the app, the API's address and the Google sign-in client ids. Every key lands where app.json had
// it, so `npx expo config --json` reads as it did when app.json held them all.
const brand = require('../shared/brand.json')

/** A plugin's options with brand values put first. Plugins are `'name'` or `['name', options]`. */
const withOptions = (plugins, name, first) => plugins.map(p => (Array.isArray(p) && p[0] === name ? [name, { ...first, ...p[1] }] : p))

module.exports = ({ config }) => {
  // `name` and `slug` arrive filled in from package.json when app.json has none: the brand's replace them. The rest
  // keeps its order (app.json's keys, then what Expo adds), and a key replaced below keeps its place.
  const { name: _name, slug: _slug, version, ...rest } = config
  const { supportsTablet, ...ios } = rest.ios
  return {
    name: brand.name,
    slug: brand.slug,
    version,
    scheme: [brand.scheme, ...brand.extraSchemes],
    ...rest,
    ios: { supportsTablet, bundleIdentifier: brand.iosBundleId, ...ios },
    android: {
      package: brand.androidPackage,
      ...rest.android,
      intentFilters: rest.android.intentFilters.map(f => ({ ...f, data: f.data.map(({ scheme, ...d }) => ({ scheme, host: brand.host, ...d })) })),
    },
    web: { ...rest.web, name: brand.storeName, shortName: brand.name },
    plugins: withOptions(
      withOptions(rest.plugins, 'expo-camera', { cameraPermission: `${brand.name} uses the camera only to read a friend's invite code.` }),
      'expo-contacts',
      { contactsPermission: `${brand.name} reads your contacts on this device to find friends who chose to be found. Only scrambled fingerprints of numbers and emails are sent, and none are kept.` },
    ),
    // the Google sign-in client ids are the operator's own: none in the brand means no Google button
    extra: { apiBase: brand.site, ...rest.extra, googleClientIds: brand.googleClientIds },
  }
}
