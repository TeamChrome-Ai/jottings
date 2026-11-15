// Android 15+ breaks a TextView's lines by glyph bounds for apps targeting API 35+, while React Native measures text by
// advances, so a line that just fits when measured wraps when drawn and the view cuts off the text's last line
// (2 Corinthians 8:9 lost "enriched." on Android 16). Text views break on advances again, as React Native's own does
// from facebook/react-native#58280 (not in 0.86): drop this plugin once the app is on a release with that change.
const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins')
const { getAppThemeGroup, setStylesItem } = AndroidConfig.Styles

const STYLE = 'AdvanceLineBreaksTextView'

module.exports = function withAdvanceLineBreaks(config) {
  return withAndroidStyles(config, c => {
    let xml = setStylesItem({
      xml: c.modResults,
      parent: { name: STYLE, parent: 'android:Widget.Material.TextView' },
      item: { $: { name: 'android:useBoundsForWidth', 'tools:targetApi': '35' }, _: 'false' },
    })
    xml = setStylesItem({ xml, parent: getAppThemeGroup(), item: { $: { name: 'android:textViewStyle' }, _: `@style/${STYLE}` } })
    c.modResults = xml
    return c
  })
}
