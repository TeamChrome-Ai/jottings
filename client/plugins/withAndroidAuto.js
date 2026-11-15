// Android Auto lists a phone app among its media apps when the app says it is one: a `com.google.android.gms.car.application`
// entry in the manifest naming an XML file that says `media`. The library a car then browses and plays is
// modules/media-library (its service is declared in that module's own manifest). The second entry is the small
// one-colour mark a car shows beside what is playing: the notification's icon, which expo-notifications writes.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const XML = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`
const ENTRIES = [
  ['com.google.android.gms.car.application', '@xml/automotive_app_desc'],
  ['androidx.car.app.TintableAttributionIcon', '@drawable/notification_icon'],
]

module.exports = function withAndroidAuto(config) {
  config = withDangerousMod(config, ['android', c => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'automotive_app_desc.xml'), XML)
    return c
  }])
  return withAndroidManifest(config, c => {
    const app = c.modResults.manifest.application[0]
    const kept = (app['meta-data'] ?? []).filter(m => !ENTRIES.some(([name]) => m.$['android:name'] === name))
    app['meta-data'] = [...kept, ...ENTRIES.map(([name, resource]) => ({ $: { 'android:name': name, 'android:resource': resource } }))]
    return c
  })
}
