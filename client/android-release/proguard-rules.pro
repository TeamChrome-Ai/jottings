# App-level R8 keep rules for the release build (minify + resource shrinking, see docs/ANDROID_RELEASE.md).
# scripts/android-signing.mjs appends this file to android/app/proguard-rules.pro between the BEGIN/END marker
# lines after every `expo prebuild`; edit it here, never in android/.
#
# Most libraries bring their own rules and need nothing here. Arriving automatically as consumer rules:
#   react-android (DoNotStrip for RN, Hermes and fbjni, NativeModule / JavaScriptModule, @ReactProp setters,
#   com.facebook.react.bridge.**, turbomodule.core.**, com.facebook.jni.**, yoga), fbcore (Fresco and SoLoader
#   DoNotStrip / DoNotOptimize), expo (ExpoModulesPackageList members, ReactActivityDelegate fields, WindowUtilKt),
#   expo-modules-core (its DoNotStrip, Module constructors, Records, Enumerable enums, SharedObject, ExpoView,
#   Services), expo-notifications (all of expo.modules.notifications), react-native-reanimated and
#   react-native-worklets (their packages, turbomodule.**, fabric.**), react-native-svg (com.horcrux.svg.**),
#   kotlin-reflect (kotlin.Metadata, Signature and annotations), kotlinx-coroutines, okhttp / okio, androidx (startup
#   initializers, fragments, lifecycle, WorkManager workers, Room databases, media3, camera), Firebase components and
#   play-services (registrars, @KeepForSdk), ML Kit barcode scanning. Manifest components (activities, services,
#   receivers, providers) and views named in layouts are kept by the rules AAPT2 writes at build time.
# Libraries with Android code but no rules of their own: react-native-screens, react-native-gesture-handler,
# react-native-safe-area-context, @react-native-async-storage/async-storage, @react-native-masked-view/masked-view,
# react-native-android-widget, expo-camera, expo-contacts. Each one's needs are covered below or by the rules above.
#
# Checked 2026-09-27 by running AGP 8.12's own R8 (8.12.14, full mode, as AGP configures it) over the versionCode 28
# program with every library's consumer rules: no missing classes, and each class found reached by name from JNI or
# reflection survives. Most rules below are insurance the simulation showed R8 would honour anyway (R8 turns a
# constant Class.forName into a class reference; AAPT2 keeps manifest components by name); each says so. The ones
# that change the output today: RNHeadlessAppLoader (removed without it), the widget library's class names (renamed
# without it), and eight hybrid members that become explicit roots (expo's WorkletNativeRuntime.mHybridData, which
# has no @DoNotStrip, among them).

# --- fbjni hybrid classes (react-native-screens NativeProxy, expo-modules-core, RN itself) ---------------------------
# C++ finds a hybrid class by its name, reads its mHybridData field and calls its (HybridData) constructor. RN has
# these rules in ReactAndroid's fbjni.pro, which is not part of the published react-android consumer rules; its own
# classes carry @DoNotStrip instead, so this is for libraries whose class has only a @DoNotStrip field.
-keepclassmembers class * {
    com.facebook.jni.HybridData *;
    <init>(com.facebook.jni.HybridData);
}
-keepclasseswithmembers class * {
    com.facebook.jni.HybridData *;
}

# --- @ReactModule / @ReactProp read by reflection --------------------------------------------------------------------
# The packages of gesture-handler, async-storage, safe-area-context, svg, reanimated and worklets read
# @ReactModule with getAnnotation() (gesture-handler and async-storage with `!!`, an NPE at startup if it were
# gone); RN reads @ReactProp / @ReactPropGroup to find view setters. Keep the annotation types and their members.
-keep @interface com.facebook.react.module.annotations.ReactModule { *; }
-keep @interface com.facebook.react.uimanager.annotations.ReactProp { *; }
-keep @interface com.facebook.react.uimanager.annotations.ReactPropGroup { *; }

# --- expo ------------------------------------------------------------------------------------------------------------
# ExpoModulesPackage, ExpoModulesHelper and TaskServiceProviderHelper load the list autolinking generates with
# Class.forName("expo.modules.ExpoModulesPackageList") and call getPackageList(); expo's own rule keeps only its
# public members. R8 rewrites the constant forName today; if every expo module vanished at startup it would be this.
-keep class expo.modules.ExpoModulesPackageList { *; }
-keep class expo.modules.ExpoModulesPackageList$Companion { *; }
# AppContext looks for inline modules by name; the class exists only when expo.inlineModules is used (not today).
-keep class inline.modules.ExpoInlineModulesList { *; }
# AppLoaderProvider instantiates the class named in the manifest meta-data
# "org.unimodules.core.AppLoader#react-native-headless" (RNHeadlessAppLoader) by name, for headless JS tasks.
-keep class * implements expo.modules.apploader.HeadlessAppLoader { <init>(); }
# expo-camera decides whether barcode scanning is available with
# Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning"); were that lookup to fail, QR scanning would turn
# off without an error. (R8 rewrites the constant forName too; this keeps the name for the lookup regardless.)
-keepnames class com.google.mlkit.vision.barcode.BarcodeScanning

# --- react-native-android-widget and the app's widgets (plugins/withWidgets.js) --------------------------------------
# The widget name the JS task handler receives is the provider's getClass().getSimpleName() (VerseOfTheDay,
# ReadingStreak), RNWidgetUtil finds a provider by matching ".<name>" against its class name, and WidgetMidnight
# asks for the same names; a renamed provider would leave every widget blank. AAPT2 keeps the manifest receivers'
# names already; this also covers the classes that are not in the manifest. The library has no rules of its own,
# runs headless tasks and WorkManager workers, and is small (about 40 classes), so it is kept whole.
-keep class {{androidPackage}}.widget.** { *; }
-keep class com.reactnativeandroidwidget.** { *; }

# --- WorkManager / Room constructors made explicit (the widget library's background task runs on WorkManager) ------
# WorkManager creates its InputMerger (OverwritingInputMerger) and Room its generated WorkDatabase_Impl by name with
# the no-argument constructor. Their consumer rules keep the classes without members, which keeps that constructor
# only while android.r8.strictFullModeForKeepRules is false (AGP 8.x default; AGP 9 turns it on).
-keepclassmembers class * extends androidx.work.InputMerger {
    public <init>();
}
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}
