package expo.modules.medialibrary

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture

/**
 * Read-aloud's one media session, for the phone's lock screen and notification and for whatever browses and drives it
 * from outside: Android Auto, a watch, the system's media controls. It holds a browsable session (Android Auto lists
 * only apps that have one) from the service's start to its end, never one per chapter: Android 16 keeps a media
 * service in the foreground only while the session its notification names stays in use (reports #34 and #35).
 */
@OptIn(UnstableApi::class)
class LibraryService : MediaLibraryService() {
  private lateinit var player: ProxyPlayer
  private var session: MediaLibrarySession? = null
  private var speedShown: Pair<Float, String?>? = null
  /** Searches answered, by their words: a browser asks for the results after it is told they are in. */
  private val found = HashMap<String, List<MediaItem>>()
  private val awaitingTree = ArrayList<() -> Unit>()
  /** A car has connected and has not yet gone. */
  private var car = false

  override fun onCreate() {
    super.onCreate()
    player = ProxyPlayer(this)
    val builder = MediaLibrarySession.Builder(this, player, Library())
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    val s = builder.build()
    session = s
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { if (icon != 0) setSmallIcon(icon) })
    // Stop takes the notification away, as it did before this service
    setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
    // the phone's own reading has no controller to ask for the session: it is added here
    addSession(s)
    Bridge.service = this
    changed()
    // the tree is JavaScript's to keep right: in the app's language, and there at all on a phone that has none yet
    Bridge.send(this, "tree")
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  /**
   * A browser that has gone says nothing to the session, so the service is asked: this comes when the last of them
   * has let go. If a car was among them the drive is over, and what the car was playing waits where it is. Answering
   * true has Android tell of the next ones too.
   */
  override fun onUnbind(intent: Intent?): Boolean {
    super.onUnbind(intent)
    if (intent?.action != null) carGone()
    return true
  }

  private fun carGone() {
    if (!car) return
    car = false
    Bridge.send(this, "gone")
  }

  /** Android Auto, a car that runs Android itself, and, in a build that can be debugged, Google's Media Controller
   *  Test app, which stands in for a car in the emulator checks (scripts/android-auto-check.sh). */
  private fun isCar(s: MediaSession, c: MediaSession.ControllerInfo) = s.isAutoCompanionController(c) || s.isAutomotiveController(c) ||
    (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 && c.packageName == TEST_CONTROLLER)

  override fun onDestroy() {
    Bridge.service = null
    session?.release()
    session = null
    player.release()
    super.onDestroy()
  }

  /** JavaScript described the player anew. */
  internal fun changed() {
    val r = Bridge.reading
    val speed = r.speed to r.speedLabel
    if (speed != speedShown) {
      speedShown = speed
      session?.setMediaButtonPreferences(ImmutableList.of(speedButton(r)))
    }
    player.changed()
  }

  /** The place to continue from moved. */
  internal fun treeChanged(parent: String) {
    val n = Catalogue.children(this, parent)?.size ?: return
    session?.notifyChildrenChanged(parent, n, null)
  }

  /** The tree was written: whoever waited for the first one is answered, and whoever shows the old one is told. */
  internal fun treeWritten() {
    val held = ArrayList(awaitingTree)
    awaitingTree.clear()
    held.forEach { it() }
    treeChanged(Catalogue.ROOT)
  }

  /** Runs `answer` once there is a tree: now, when JavaScript has written the first one, or after TREE_MS with none. */
  private fun whenTree(answer: () -> Unit) {
    if (Catalogue.written(this)) return answer()
    var done = false
    val once = { if (!done) { done = true; answer() } }
    awaitingTree.add(once)
    Bridge.main.postDelayed({ awaitingTree.remove(once); once() }, TREE_MS)
  }

  private fun speedButton(r: Reading): CommandButton {
    val icon = when (r.speed) {
      0.5f -> CommandButton.ICON_PLAYBACK_SPEED_0_5
      0.8f -> CommandButton.ICON_PLAYBACK_SPEED_0_8
      1f -> CommandButton.ICON_PLAYBACK_SPEED_1_0
      1.2f -> CommandButton.ICON_PLAYBACK_SPEED_1_2
      1.5f -> CommandButton.ICON_PLAYBACK_SPEED_1_5
      1.8f -> CommandButton.ICON_PLAYBACK_SPEED_1_8
      2f -> CommandButton.ICON_PLAYBACK_SPEED_2_0
      else -> CommandButton.ICON_PLAYBACK_SPEED
    }
    return CommandButton.Builder(icon)
      .setDisplayName(r.speedLabel ?: "${r.speed}×")
      .setSessionCommand(SPEED)
      .setSlots(CommandButton.SLOT_OVERFLOW)
      .build()
  }

  private inner class Library : MediaLibrarySession.Callback {
    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
      if (isCar(session, controller)) car = true
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon().add(SPEED).build())
        .build()
    }

    /** A controller that speaks Media3 says when it goes. One of the older kind is only counted gone when it has asked
     *  for nothing in a while, which a car does through a whole psalm: its going is heard of in onUnbind. */
    override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
      if (controller.controllerVersion != MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION && isCar(session, controller)) carGone()
    }

    override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
      if (customCommand.customAction != SPEED.customAction) return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
      Bridge.send(this@LibraryService, "speed")
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    /** Answered at once, tree or no tree: a browser gives up on a root that keeps it waiting. */
    override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
      val root = MediaItem.Builder().setMediaId(Catalogue.ROOT).setMediaMetadata(MediaMetadata.Builder().setIsBrowsable(true).setIsPlayable(false).build()).build()
      return Futures.immediateFuture(LibraryResult.ofItem(root, params))
    }

    override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
      val n = Catalogue.node(this@LibraryService, mediaId) ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      return Futures.immediateFuture(LibraryResult.ofItem(Catalogue.item(this@LibraryService, n), null))
    }

    /** On a phone with no tree yet (the app has not run since it was installed) the answer waits for JavaScript to
     *  write the first one. */
    override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val result = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
      whenTree {
        val all = Catalogue.children(this@LibraryService, parentId)
        // the moment a car's first list is ready, for the check that times it (docs/ANDROID_RELEASE.md)
        if (parentId == Catalogue.ROOT) Log.i("MediaLibrary", "root listed: ${all?.size ?: 0} entries")
        result.set(when {
          all != null -> LibraryResult.ofItemList(paged(all.map { Catalogue.item(this@LibraryService, it) }, page, pageSize), params)
          parentId == Catalogue.ROOT -> LibraryResult.ofItemList(ImmutableList.of(), params)
          else -> LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
        })
      }
      return result
    }

    override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
      Bridge.find(this@LibraryService, query) { json ->
        val items = Catalogue.items(this@LibraryService, json)
        if (found.size >= FOUND_KEPT) found.clear()
        found[query] = items
        session.notifySearchResultChanged(browser, query, items.size, params)
      }
      return Futures.immediateFuture(LibraryResult.ofVoid())
    }

    override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      found[query]?.let { return Futures.immediateFuture(LibraryResult.ofItemList(paged(it, page, pageSize), params)) }
      val result = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
      Bridge.find(this@LibraryService, query) { json -> result.set(LibraryResult.ofItemList(paged(Catalogue.items(this@LibraryService, json), page, pageSize), params)) }
      return result
    }

    /** A controller names what to play by an id from the tree, or by the words of a search ("play John 3"): either way
     *  JavaScript finds the chapter, so the item goes to the player as it is, a search under an id of its own. */
    override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: List<MediaItem>): ListenableFuture<List<MediaItem>> =
      Futures.immediateFuture(mediaItems.map { item ->
        val query = item.requestMetadata.searchQuery
        when {
          item.mediaId.isNotEmpty() -> Catalogue.node(this@LibraryService, item.mediaId)?.let { Catalogue.item(this@LibraryService, it) } ?: item
          query != null -> MediaItem.Builder().setMediaId(ProxyPlayer.QUERY + query)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(query).setIsBrowsable(false).setIsPlayable(true).build()).build()
          else -> item
        }
      })
  }

  private fun paged(items: List<MediaItem>, page: Int, pageSize: Int): ImmutableList<MediaItem> {
    val from = (page.toLong() * pageSize).coerceIn(0, items.size.toLong()).toInt()
    val to = (from.toLong() + pageSize).coerceIn(0, items.size.toLong()).toInt()
    return ImmutableList.copyOf(items.subList(from, to))
  }

  companion object {
    private val SPEED = SessionCommand("expo.modules.medialibrary.SPEED", Bundle.EMPTY)
    private const val FOUND_KEPT = 16
    private const val TREE_MS = 8000L
    private const val TEST_CONTROLLER = "com.example.android.mediacontroller"
  }
}
