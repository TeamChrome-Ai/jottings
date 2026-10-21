package expo.modules.storeupdate

import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What Google Play offers this phone (src/lib/storeUpdate.ts): Play's own answer, so the app never speaks of a version
 * Play has not yet released to it (in review, or a staged rollout that has not reached it).
 */
class StoreUpdateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StoreUpdate")

    /** { available, versionCode, staleDays } from Play, staleDays being how long this phone has been offered it; null
     *  when Play has no answer (not installed from Play, no Play services, offline). */
    AsyncFunction("check") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) { promise.resolve(null); return@AsyncFunction }
      try {
        AppUpdateManagerFactory.create(ctx).appUpdateInfo
          .addOnSuccessListener { info ->
            promise.resolve(mapOf(
              "available" to (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE),
              "versionCode" to info.availableVersionCode(),
              "staleDays" to info.clientVersionStalenessDays()
            ))
          }
          .addOnFailureListener { promise.resolve(null) }
      } catch (e: Exception) {
        promise.resolve(null)
      }
    }
  }
}
