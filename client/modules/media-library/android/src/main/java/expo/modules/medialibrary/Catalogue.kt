package expo.modules.medialibrary

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One entry of the tree: with `children` it is browsed, without it is played. */
internal class Node(val id: String, val title: String, val subtitle: String?, val icon: String?, val children: List<String>?)

/**
 * The tree a car browses, as the app wrote it (src/lib/carCatalogue.ts): a file, so it is there before JavaScript is.
 * The place to continue from changes with every verse, so it is kept apart and stands where the tree says "@place".
 */
internal object Catalogue {
  private const val TAG = "MediaLibrary"
  const val ROOT = "root"
  private const val PLACE = "@place"
  private const val PREFS = "media_library"

  private var nodes: Map<String, Node> = emptyMap()
  private var read = false
  private var place: Node? = null
  private var placeRead = false

  private fun file(context: Context) = File(File(context.filesDir, "media-library"), "catalogue.json")

  private fun load(context: Context) {
    if (read) return
    read = true
    try {
      val f = file(context)
      if (!f.exists()) return
      val json = JSONObject(f.readText())
      val all = json.getJSONObject("nodes")
      val out = HashMap<String, Node>(all.length())
      for (id in all.keys()) out[id] = node(id, all.getJSONObject(id))
      nodes = out
    } catch (e: Exception) {
      Log.w(TAG, "the catalogue could not be read", e)
      nodes = emptyMap()
    }
  }

  private fun node(id: String, o: JSONObject): Node {
    val c: JSONArray? = o.optJSONArray("c")
    return Node(id, o.optString("t"), o.optString("s").ifEmpty { null }, o.optString("i").ifEmpty { null }, c?.let { a -> List(a.length()) { a.getString(it) } })
  }

  /** What names the catalogue on file (its language, its Bible, its version), for the app to know whether to write it
   *  again; kept beside the file, so asking does not read it. */
  fun key(context: Context): String? = if (file(context).exists()) prefs(context).getString("key", null) else null

  fun write(context: Context, key: String, json: String) {
    val f = file(context)
    f.parentFile?.mkdirs()
    val tmp = File(f.parentFile, f.name + ".tmp")
    tmp.writeText(json)
    if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    prefs(context).edit().putString("key", key).apply()
    read = false
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** The place as it was last set, for JavaScript to resume from. */
  fun placeJson(context: Context): String? = prefs(context).getString("place", null)

  fun place(context: Context): Node? {
    if (!placeRead) {
      placeRead = true
      place = parsePlace(placeJson(context))
    }
    return place
  }

  fun setPlace(context: Context, json: String?) {
    prefs(context).edit().apply { if (json == null) remove("place") else putString("place", json) }.apply()
    place = parsePlace(json)
    placeRead = true
  }

  private fun parsePlace(json: String?): Node? = try {
    json?.let { JSONObject(it) }?.let { node(it.getString("id"), it) }
  } catch (e: Exception) { null }

  /** A tree has been written: before the first one, a browser's first question waits for it. */
  fun written(context: Context): Boolean { load(context); return nodes.isNotEmpty() }

  fun node(context: Context, id: String): Node? {
    load(context)
    return nodes[id] ?: place(context)?.takeIf { it.id == id }
  }

  fun children(context: Context, id: String): List<Node>? {
    load(context)
    val ids = nodes[id]?.children ?: return null
    return ids.mapNotNull { if (it == PLACE) place(context) else nodes[it] }
  }

  fun item(context: Context, n: Node): MediaItem {
    val browsable = n.children != null
    val icon = n.icon?.let { context.resources.getIdentifier("media_library_$it", "drawable", context.packageName) }?.takeIf { it != 0 }
    val meta = MediaMetadata.Builder()
      .setTitle(n.title)
      .setSubtitle(n.subtitle)
      .setIsBrowsable(browsable)
      .setIsPlayable(!browsable)
      .setMediaType(if (browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
      .setArtworkUri(icon?.let { Uri.parse("android.resource://${context.packageName}/$it") })
      .build()
    return MediaItem.Builder().setMediaId(n.id).setMediaMetadata(meta).build()
  }

  /** Items a search found, as JavaScript sent them: `[{ id, t, s }]`. */
  fun items(context: Context, json: String): List<MediaItem> = try {
    val a = JSONArray(json)
    List(a.length()) { a.getJSONObject(it) }.map { item(context, node(it.getString("id"), it)) }
  } catch (e: Exception) { emptyList() }
}
