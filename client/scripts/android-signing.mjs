// Re-applies the Android build settings to the generated android/ project after `expo prebuild` (android/ is not
// committed, so this script is the only durable place for them): release signing, build JVM memory, release lint off,
// R8 minification and resource shrinking with the app's keep rules, and the Baseline Profile. Run from client/
// (`npm run prebuild:android` does). Every step checks before it writes, so a second run changes nothing, and a step
// whose anchor has gone from Expo's template stops the script with an error instead of silently not applying.
// Reads nothing secret: signing reads client/credentials/keystore.properties at Gradle time (storeFile is relative to
// android/app/). Settings and what to check in the build output: docs/ANDROID_RELEASE.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const gradle = 'android/app/build.gradle'
const props = 'android/gradle.properties'
if (!existsSync(gradle)) { console.error('run `npx expo prebuild --platform android` first'); process.exit(1) }
// the committed inputs, found next to this script so the script works from any copy of client/
const release = file => fileURLToPath(new URL(`../android-release/${file}`, import.meta.url))
// They name the app and its package as {{name}}, {{androidPackage}} and {{androidPackagePath}} (the package with
// slashes, as a profile writes a class); the values are the brand's (shared/brand.json, docs/BRAND.md).
const brand = JSON.parse(readFileSync(new URL('../../shared/brand.json', import.meta.url), 'utf8'))
const BRANDED = { name: brand.name, androidPackage: brand.androidPackage, androidPackagePath: brand.androidPackage.replace(/\./g, '/') }
/** A committed input's text with the brand's values in place of its {{…}} marks; an unknown mark stops the script. */
const releaseText = file => readFileSync(release(file), 'utf8').replace(/\{\{(\w+)\}\}/g, (mark, key) => BRANDED[key] ?? fail(`client/android-release/${file} has ${mark}, which is not a brand value this script knows`))

/** Applies `edit` to a file and writes it back only if the text changed. */
let changes = 0
function patch(file, label, edit) {
  const before = readFileSync(file, 'utf8')
  const after = edit(before)
  if (after !== before) { writeFileSync(file, after); console.log(label); changes++ }
}
function fail(message) { console.error(`android-signing: ${message}`); process.exit(1) }

/** Sets `key=value` in a .properties text: replaces the key's line if there is one, else appends it under `comment`. */
function setProperty(text, key, value, comment) {
  const line = new RegExp(`^${key.replace(/\./g, '\\.')}=.*$`, 'm')
  if (line.test(text)) return text.replace(line, `${key}=${value}`)
  return comment.length
    ? `${text.replace(/\n*$/, '\n')}\n${comment.map(c => `# ${c}\n`).join('')}${key}=${value}\n`
    : `${text.replace(/\n*$/, '\n')}${key}=${value}\n`
}

// prebuild resets gradle.properties to Expo's -Xmx2048m / 512m metaspace; lintVitalAnalyzeRelease dies with
// "OutOfMemoryError: Metaspace" at that size on this 7 GB box, and the whole daemon died at 1g (build 25, 2026-09-25):
// no metaspace cap, and release lint (lintVital) is off below, since it only repeats what the AAB upload checks
// R8 over this app (about 50 MB of dex before shrinking) runs in the Gradle JVM and ran out of a 3 GB heap (build 28);
// the Kotlin daemon is its own JVM, capped so both fit on a 7 GB box
const heap = process.env.BEREAN_GRADLE_HEAP ?? '4608m'   // a bigger builder: BEREAN_GRADLE_HEAP=10g with BEREAN_R8=1
patch(props, 'gradle jvmargs set', p => p.replace(/^org\.gradle\.jvmargs=.*$/m, `org.gradle.jvmargs=-Xmx${heap} -XX:+UseParallelGC`))
patch(props, 'kotlin daemon heap set', p => /^kotlin\.daemon\.jvmargs=/m.test(p) ? p.replace(/^kotlin\.daemon\.jvmargs=.*$/m, 'kotlin.daemon.jvmargs=-Xmx1g') : `${p.replace(/\n?$/, '\n')}kotlin.daemon.jvmargs=-Xmx1g\n`)

// release lint (lintVital) runs inside the build JVM and exhausts metaspace on this box
patch(gradle, 'release lint disabled', b =>
  b.includes('checkReleaseBuilds') ? b : b.replace(/\nandroid \{/, '\nandroid {\n    lint { checkReleaseBuilds = false }'))

// release signing from credentials/keystore.properties; the debug key stays in use while that file is absent
patch(gradle, 'release signing configured from credentials/keystore.properties', s => {
  if (s.includes('keystoreProps')) return s
  s = s.replace('android {', `def keystoreProps = new Properties()
def keystoreFile = rootProject.file("../credentials/keystore.properties")
if (keystoreFile.exists()) keystoreProps.load(new FileInputStream(keystoreFile))

android {`)
  s = s.replace('    signingConfigs {\n        debug {', `    signingConfigs {
        release {
            if (keystoreFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
        debug {`)
  // only the release buildType (the debug buildType also says `signingConfig signingConfigs.debug`)
  return s.replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig keystoreFile.exists() ? signingConfigs.release : signingConfigs.debug')
})

// R8 minification and resource shrinking in release builds. Expo's template reads exactly these two properties
// (findProperty in app/build.gradle), so the check below fails the script if a template update renames them rather
// than letting a release go out unminified. R8 full mode stays at AGP's default (on); see docs/ANDROID_RELEASE.md.
{
  const b = readFileSync(gradle, 'utf8')
  for (const key of ['android.enableMinifyInReleaseBuilds', 'android.enableShrinkResourcesInReleaseBuilds']) {
    if (!b.includes(`findProperty('${key}')`)) fail(`app/build.gradle no longer reads ${key}; update this script`)
  }
  if (!/proguardFiles getDefaultProguardFile\("proguard-android\.txt"\), "proguard-rules\.pro"/.test(b)) {
    fail('app/build.gradle no longer lists proguard-rules.pro in the release proguardFiles; update this script')
  }
}
// R8 over this app needs more heap than this 7 GB build box can give (it ran out at 4.5 GB, build 28), so it is on
// only where the machine can hold it: BEREAN_R8=1 npm run prebuild:android on a 16 GB+ builder. Off, the release is
// built exactly as before R8 was added; the keep rules and the Baseline Profile below apply either way.
const r8 = process.env.BEREAN_R8 === '1' ? 'true' : 'false'
patch(props, `R8 minify and resource shrinking ${r8 === 'true' ? 'on' : 'off'} for release`, p => {
  p = setProperty(p, 'android.enableMinifyInReleaseBuilds', r8,
    ['R8 minification and resource shrinking for release (scripts/android-signing.mjs, docs/ANDROID_RELEASE.md)'])
  return setProperty(p, 'android.enableShrinkResourcesInReleaseBuilds', r8, [])
})

// resource shrinking dropped the widgets' description strings (the launcher logged NotFoundException for them, build
// 28): they are reached only through the appwidget-provider XML, so they are kept by name here
{
  const dir = 'android/app/src/main/res/raw'
  const f = `${dir}/keep_widgets.xml`
  const want = '<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools"\n  tools:keep="@string/widget_*,@xml/widgetprovider_*" />\n'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(f) || readFileSync(f, 'utf8') !== want) { writeFileSync(f, want); console.log('widget resources kept') }
}

// the app's keep rules: client/android-release/proguard-rules.pro, kept in one marked block at the end of the
// template's proguard-rules.pro and replaced whole on each run, so an edit to the committed file always lands
const BEGIN = '# BEGIN client/android-release/proguard-rules.pro (copied by scripts/android-signing.mjs; edit that file)'
const END = '# END client/android-release/proguard-rules.pro'
patch('android/app/proguard-rules.pro', 'app keep rules written to proguard-rules.pro', p => {
  const block = `${BEGIN}\n${releaseText('proguard-rules.pro').replace(/\n*$/, '\n')}${END}\n`
  const start = p.indexOf(BEGIN)
  if (start === -1) return `${p.replace(/\n*$/, '\n')}\n${block}`
  const end = p.indexOf(END, start)
  if (end === -1) fail(`android/app/proguard-rules.pro has "${BEGIN}" without its END line; delete the block and re-run`)
  return p.slice(0, start) + block + p.slice(end + END.length).replace(/^\n/, '')
})

// Baseline Profile: AGP compiles app/src/main/baseline-prof.txt (next to the main manifest) into the APK / bundle,
// and profileinstaller writes it for ART where the store does not (sideloads, Android 7-8). profileinstaller already
// arrives through androidx; declaring it pins it. 1.4.0 is what the build resolved (Gradle cache, 2026-09-26).
{
  const target = 'android/app/src/main/baseline-prof.txt'
  const profile = releaseText('baseline-prof.txt')
  if (!existsSync(target) || readFileSync(target, 'utf8') !== profile) {
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, profile); console.log('baseline profile written'); changes++
  }
}
patch(gradle, 'profileinstaller dependency added', b => {
  const dep = 'implementation("androidx.profileinstaller:profileinstaller:1.4.0")'
  if (/androidx\.profileinstaller:profileinstaller:/.test(b)) return b.replace(/implementation\("androidx\.profileinstaller:profileinstaller:[^"]*"\)/, dep)
  const anchor = /\n([ \t]*)implementation\("com\.facebook\.react:react-android"\)\n/
  if (!anchor.test(b)) fail('app/build.gradle has no react-android dependency line to add profileinstaller after; update this script')
  return b.replace(anchor, (line, indent) => `${line}${indent}// installs the Baseline Profile (client/android-release/baseline-prof.txt)\n${indent}${dep}\n`)
})

// prebuild also wipes local.properties; without it gradle cannot find the SDK
if (!existsSync('android/local.properties')) { writeFileSync('android/local.properties', `sdk.dir=${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}\n`); console.log('local.properties restored'); changes++ }
console.log(changes ? `android settings: ${changes} change(s) applied` : 'android settings already up to date')
