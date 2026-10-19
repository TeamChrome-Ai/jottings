package expo.modules.readaloudclock

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioPlaybackConfiguration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * React Native fires the app's timers only while its activity is in front or a headless JS task is open
 * (JavaTimerManager): with the screen locked, or Maps in front, every setTimeout stops. Read-aloud runs on timers
 * (a verse's end, the pause after it, the next chapter), so while it reads the app opens one headless task. The task
 * is the JS function registered under `taskKey`; it ends when its promise settles (src/lib/readAloudClock.ts).
 *
 * Also what the read-aloud log (src/lib/readAloudLog.ts) needs from the phone to trace a reading that stopped by
 * itself: its battery settings for the app, Android's own record of why it closed the app, and, while a reading is
 * on, every change in what else is sounding (a call, a navigation voice) and where the sound goes (a car, a headset).
 */
class ReadAloudClockModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var playbackWatch: AudioManager.AudioPlaybackCallback? = null
  private var deviceWatch: AudioDeviceCallback? = null
  private var modeWatch: AudioManager.OnModeChangedListener? = null
  private var lastScene: Map<String, Any?>? = null

  private val context: Context? get() = appContext.reactContext
  private val audio: AudioManager? get() = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("ReadAloudClock")
    Events("onAudioScene")

    Function("hold") { taskKey: String ->
      val context = appContext.reactContext as? ReactContext ?: return@Function false
      UiThreadUtil.runOnUiThread {
        try {
          // no timeout: the reading ends it; allowed in the foreground, where the reader presses Listen
          HeadlessJsTaskContext.getInstance(context).startTask(HeadlessJsTaskConfig(taskKey, Arguments.createMap(), 0, true))
        } catch (e: Exception) {
          Log.w("ReadAloudClock", "could not open the read-aloud task", e)
        }
      }
      true
    }

    Function("snapshot") { snapshot() }

    /** The app's last process exits as Android recorded them (Android 11+; empty before). */
    Function("exitReasons") { max: Int ->
      val ctx = context ?: return@Function emptyList<Map<String, Any?>>()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@Function emptyList<Map<String, Any?>>()
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return@Function emptyList<Map<String, Any?>>()
      try {
        am.getHistoricalProcessExitReasons(ctx.packageName, 0, max).map {
          mapOf("t" to it.timestamp.toDouble(), "reason" to it.reason, "importance" to it.importance, "status" to it.status, "description" to it.description)
        }
      } catch (e: Exception) {
        emptyList<Map<String, Any?>>()
      }
    }

    /** While on, `onAudioScene` fires with `scene()` whenever it changes. */
    Function("watch") { on: Boolean ->
      main.post { if (on) watch() else unwatch() }
    }

    OnDestroy { main.post { unwatch() } }
  }

  /** What else is sounding, where the sound goes, and the media volume. */
  private fun scene(am: AudioManager, configs: List<AudioPlaybackConfiguration>? = null): Map<String, Any?> {
    val players = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) (configs ?: am.activePlaybackConfigurations) else emptyList()
    return mapOf(
      "mode" to am.mode,
      // usage and, where Android's description carries it, the player's state: "12:started" is a navigation voice speaking
      "playing" to players.map { "${it.audioAttributes.usage}:${STATE.find(it.toString())?.groupValues?.get(1) ?: ""}" }.sorted(),
      "outputs" to am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.distinct().sorted(),
      "volume" to am.getStreamVolume(AudioManager.STREAM_MUSIC),
      "volumeMax" to am.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
    )
  }

  private fun snapshot(): Map<String, Any?> {
    val ctx = context ?: return emptyMap()
    val power = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val activity = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    val out = mutableMapOf<String, Any?>(
      "sdk" to Build.VERSION.SDK_INT, "release" to Build.VERSION.RELEASE, "maker" to Build.MANUFACTURER, "model" to Build.MODEL,
      "unrestricted" to power?.isIgnoringBatteryOptimizations(ctx.packageName),
      "powerSave" to power?.isPowerSaveMode, "dozing" to power?.isDeviceIdleMode, "screenOn" to power?.isInteractive,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      out["backgroundRestricted"] = activity?.isBackgroundRestricted
      out["bucket"] = (ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager)?.appStandbyBucket
    }
    audio?.let { out.putAll(scene(it)) }
    return out
  }

  private fun changed(configs: List<AudioPlaybackConfiguration>? = null) {
    val am = audio ?: return
    val s = scene(am, configs)
    if (s == lastScene) return
    lastScene = s
    sendEvent("onAudioScene", s)
  }

  private fun watch() {
    val am = audio ?: return
    if (deviceWatch != null) return
    lastScene = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      playbackWatch = object : AudioManager.AudioPlaybackCallback() {
        override fun onPlaybackConfigChanged(configs: MutableList<AudioPlaybackConfiguration>) = changed(configs)
      }.also { am.registerAudioPlaybackCallback(it, main) }
    }
    deviceWatch = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = changed()
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = changed()
    }.also { am.registerAudioDeviceCallback(it, main) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val ctx = context ?: return
      modeWatch = AudioManager.OnModeChangedListener { changed() }.also { am.addOnModeChangedListener(ctx.mainExecutor, it) }
    }
  }

  private fun unwatch() {
    val am = audio ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) playbackWatch?.let { am.unregisterAudioPlaybackCallback(it) }
    deviceWatch?.let { am.unregisterAudioDeviceCallback(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) modeWatch?.let { am.removeOnModeChangedListener(it) }
    playbackWatch = null; deviceWatch = null; modeWatch = null; lastScene = null
  }

  private companion object {
    val STATE = Regex("state:(\\w+)")
  }
}
