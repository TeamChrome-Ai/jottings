package expo.modules.medialibrary

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication

/** The player as JavaScript last described it (src/lib/car.ts): the one thing the session shows. */
internal data class Reading(
  /** "idle" is no reading in hand: the session then shows nothing on the phone. Any other is one, from Listen until Stop. */
  val status: String = "idle",
  val id: String? = null,
  val title: String? = null,
  val subtitle: String? = null,
  val art: String? = null,
  val speed: Float = 1f,
  val speedLabel: String? = null,
  val error: String? = null,
  /** The last command JavaScript has acted on. */
  val ack: Int = 0,
)

/**
 * Between the service, which a car can start before the app has ever been opened, and JavaScript, where the player is.
 * A command waits here until JavaScript says it is listening; asking for one starts JavaScript if it is not running.
 * Everything here is on the main thread.
 */
internal object Bridge {
  private const val TAG = "MediaLibrary"
  val main = Handler(Looper.getMainLooper())
  private var emit: ((Map<String, Any?>) -> Unit)? = null
  private val waiting = ArrayList<Map<String, Any?>>()
  private var seq = 0
  private val finds = HashMap<String, MutableList<(String) -> Unit>>()

  var reading = Reading()
    private set
  var service: LibraryService? = null

  /** Sends a command to the player, now or once JavaScript is up; returns its number, which `Reading.ack` answers. */
  fun send(context: Context, type: String, extra: Map<String, Any?> = emptyMap()): Int {
    val n = ++seq
    val command = HashMap(extra).apply { put("seq", n); put("type", type) }
    val e = emit
    if (e != null) e(command) else { waiting.add(command); wake(context) }
    return n
  }

  /** Asks JavaScript which items a search names; `done` gets their JSON, or "[]" when no answer comes in time. */
  fun find(context: Context, query: String, done: (String) -> Unit) {
    val asked = finds[query]
    if (asked != null) { asked.add(done); return }
    finds[query] = mutableListOf(done)
    send(context, "find", mapOf("query" to query))
    main.postDelayed({ found(query, "[]") }, FIND_MS)
  }

  fun found(query: String, items: String) { finds.remove(query)?.forEach { it(items) } }

  fun listening(e: (Map<String, Any?>) -> Unit) {
    emit = e
    val held = ArrayList(waiting)
    waiting.clear()
    held.forEach(e)
  }

  fun deaf() { emit = null }

  fun describe(r: Reading) {
    reading = r
    service?.changed()
  }

  /** Starts the app's JavaScript with no screen, as a home-screen widget's drawing does. */
  private fun wake(context: Context) {
    try {
      val host = (context.applicationContext as? ReactApplication)?.reactHost ?: return
      if (host.currentReactContext == null) host.start()
    } catch (e: Exception) {
      Log.w(TAG, "could not start JavaScript", e)
    }
  }

  private const val FIND_MS = 4000L
}
