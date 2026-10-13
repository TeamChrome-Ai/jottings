// Android trusts only the system CA store inside apps. Filtering VPNs used by much of this app's audience
// (Streamline 3 / UBT) re-sign HTTPS with a CA installed in the user store, so the app could not reach its own
// server on those phones. This config trusts user-installed CAs for the app's own hosts only (the brand's `host` and
// `extraHosts`, shared/brand.json); every other host keeps system-only trust.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')
const brand = require('../../shared/brand.json')

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config>
${[brand.host, ...brand.extraHosts].map(h => `    <domain includeSubdomains="true">${h}</domain>`).join('\n')}
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`

module.exports = function withNetworkSecurityConfig(config) {
  config = withDangerousMod(config, ['android', c => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'network_security_config.xml'), XML)
    return c
  }])
  return withAndroidManifest(config, c => {
    const app = c.modResults.manifest.application[0]
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return c
  })
}
