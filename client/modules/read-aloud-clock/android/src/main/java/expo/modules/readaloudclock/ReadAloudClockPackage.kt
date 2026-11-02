package expo.modules.readaloudclock

import android.app.Application
import android.content.Context
import com.facebook.react.modules.core.ReactChoreographer
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Puts ReadingFrames under React Native before its first instance does: React Native keeps the first one it is given. */
class ReadAloudClockPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) = ReactChoreographer.initialize(ReadingFrames)
    })
}
