package expo.modules.medialibrary

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import androidx.media3.session.MediaSession
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedObject

/**
 * JavaScript's side of the media session (src/lib/car.ts): it describes the player, writes the tree a car browses and
 * the place to continue from, and hears what a controller asks for as `onCommand`.
 */
class MediaLibraryModule : Module() {
  private var bound = false
  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {}
    override fun onServiceDisconnected(name: ComponentName?) {}
  }

  override fun definition() = ModuleDefinition {
    Name("MediaLibrary")
    Events("onCommand")

    /** JavaScript is listening: commands that waited for it come now. */
    Function("listen") {
      Bridge.main.post { Bridge.listening { command -> sendEvent("onCommand", command) } }
    }

    Function("describe") { r: Map<String, Any?> ->
      val reading = Reading(
        on = r["on"] == true,
        status = r["status"] as? String ?: "idle",
        id = r["id"] as? String,
        title = r["title"] as? String,
        subtitle = r["subtitle"] as? String,
        art = r["art"] as? String,
        speed = (r["speed"] as? Number)?.toFloat() ?: 1f,
        speedLabel = r["speedLabel"] as? String,
        error = r["error"] as? String,
        ack = (r["ack"] as? Number)?.toInt() ?: 0,
      )
      Bridge.main.post {
        // the phone's own Listen: the service that shows it starts here, while the app is on screen
        if (reading.on) bind()
        Bridge.describe(reading)
      }
    }

    /** What names the tree on file, null for none. */
    Function("catalogueKey") { appContext.reactContext?.let { Catalogue.key(it) } }

    Function("publish") { key: String, json: String ->
      val context = appContext.reactContext ?: return@Function
      Bridge.main.post {
        Catalogue.write(context, key, json)
        Bridge.service?.treeWritten()
      }
    }

    Function("place") { appContext.reactContext?.let { Catalogue.placeJson(it) } }

    /**
     * expo-audio gives every sound a media session of its own, and Android would show two for one reading (the
     * car's controls could land on the wrong one). The sound's own is let go here; the app's one is the library's.
     * The session is expo-audio's private field: if a later expo-audio names it otherwise, nothing is released and
     * the log says so (scripts/android-auto-check.sh counts the sessions).
     */
    Function("own") { sound: SharedObject ->
      Bridge.main.post {
        try {
          val getter = sound.javaClass.methods.firstOrNull { it.name.startsWith("getMediaSession") && it.parameterCount == 0 }
          val session = getter?.invoke(sound) as? MediaSession
          if (session != null) session.release() else Log.w("MediaLibrary", "expo-audio's own media session was not found on ${sound.javaClass.name}")
        } catch (e: Exception) {
          Log.w("MediaLibrary", "expo-audio's own media session could not be released", e)
        }
      }
    }

    Function("setPlace") { json: String?, parent: String ->
      val context = appContext.reactContext ?: return@Function
      Bridge.main.post {
        Catalogue.setPlace(context, json)
        Bridge.service?.treeChanged(parent)
        Bridge.service?.changed()
      }
    }

    Function("found") { query: String, items: String ->
      Bridge.main.post { Bridge.found(query, items) }
    }

    OnDestroy {
      Bridge.main.post { Bridge.deaf() }
      unbind()
    }
  }

  private fun bind() {
    if (bound) return
    val context: Context = appContext.reactContext?.applicationContext ?: return
    try {
      bound = context.bindService(Intent(context, LibraryService::class.java), connection, Context.BIND_AUTO_CREATE)
    } catch (e: Exception) {
      Log.w("MediaLibrary", "could not start the media service", e)
    }
  }

  private fun unbind() {
    if (!bound) return
    bound = false
    try { appContext.reactContext?.applicationContext?.unbindService(connection) } catch (e: Exception) { /* already gone */ }
  }
}
