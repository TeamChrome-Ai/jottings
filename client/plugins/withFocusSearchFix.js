// React Native 0.86's fix for a native crash on Android, which the release leaves switched off.
//
// When a text field inside a scrolling screen is tapped, Android asks the scroll view for the next field to focus (to
// offer a "Next" key on the keyboard). React Native answers by walking its own tree of the screen, holding only a raw
// pointer to the tree's root; if the JS side commits a new tree in that moment, the old root is freed under the walk
// and the app dies (SIGSEGV in findShadowNodeByTagRecursively; Play vitals, 1.3.7 (68), two readers on Android 17).
// The safe walk, which keeps the root alive, is already in 0.86 behind `fixFindShadowNodeByTagRaceCondition`, off by
// default (react/react-native#55751; 0.87 removes the flag and always walks safely, so this plugin goes with Expo 58).
//
// loadReactNative() has already set the flags for the release level, and setting them a second time with override()
// throws at startup. dangerouslyForceOverride() swaps in the same release level's flags with this one turned on.
const { withMainApplication } = require('expo/config-plugins')

const ANCHOR = /^(\s*)loadReactNative\(this\)\s*$/m
const MARK = 'fixFindShadowNodeByTagRaceCondition'

const IMPORTS = [
  'com.facebook.react.internal.featureflags.ReactNativeFeatureFlags',
  'com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android',
  'com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android',
  'com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android',
  'com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider',
]

const call = indent => [
  `${indent}// plugins/withFocusSearchFix.js: React Native's safe tree walk, so focusing a field in a scroll view cannot crash`,
  `${indent}val releaseFlags: ReactNativeFeatureFlagsProvider = when (DefaultNewArchitectureEntryPoint.releaseLevel) {`,
  `${indent}  ReleaseLevel.EXPERIMENTAL -> ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()`,
  `${indent}  ReleaseLevel.CANARY -> ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()`,
  `${indent}  ReleaseLevel.STABLE -> ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()`,
  `${indent}}`,
  `${indent}ReactNativeFeatureFlags.dangerouslyForceOverride(object : ReactNativeFeatureFlagsProvider by releaseFlags {`,
  `${indent}  override fun ${MARK}(): Boolean = true`,
  `${indent}})`,
].join('\n')

module.exports = config => withMainApplication(config, cfg => {
  const app = cfg.modResults
  if (app.language !== 'kt') throw new Error('withFocusSearchFix: MainApplication is not Kotlin')
  let src = app.contents
  if (src.includes(MARK)) return cfg
  const m = src.match(ANCHOR)
  // without the flag the crash ships again, so a template that no longer calls loadReactNative(this) stops the build
  if (!m) throw new Error('withFocusSearchFix: no loadReactNative(this) in MainApplication.kt to put the flag after')
  src = src.replace(ANCHOR, `${m[0]}\n${call(m[1])}`)
  const missing = ['com.facebook.react.common.ReleaseLevel', 'com.facebook.react.defaults.DefaultNewArchitectureEntryPoint', ...IMPORTS]
    .filter(imp => !src.includes(`import ${imp}\n`))
  if (missing.length) src = src.replace(/^(package [^\n]+\n)/, `$1\n${missing.map(imp => `import ${imp}`).join('\n')}\n`)
  app.contents = src
  return cfg
})
