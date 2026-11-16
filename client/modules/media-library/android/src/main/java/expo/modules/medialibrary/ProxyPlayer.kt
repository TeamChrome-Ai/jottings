package expo.modules.medialibrary

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The player a media session needs, with no sound of its own: read-aloud is JavaScript (src/store/player.tsx), which
 * times verses, speaks numbers on a clip of their own and falls back to the device's voice. This shows what that player
 * says it is doing and passes it what a controller asks for. Until JavaScript answers a command, what was asked for is
 * shown (a car that asks for Psalm 23 of a phone app that is not running sees it loading while JavaScript starts).
 */
@OptIn(UnstableApi::class)
internal class ProxyPlayer(private val context: Context) : SimpleBasePlayer(Bridge.main.looper) {
  /** A command JavaScript has not answered yet, and what it should lead to. */
  private class Asked(val seq: Int, val playing: Boolean?, val item: MediaItem?, val until: Long)
  private var asked: Asked? = null
  /** An item a controller chose and has not yet asked to play. */
  private var chosen: MediaItem? = null
  private val recheck = Runnable { invalidateState() }

  fun changed() = invalidateState()

  private fun pending(): Asked? {
    val a = asked ?: return null
    if (Bridge.reading.ack >= a.seq || SystemClock.elapsedRealtime() >= a.until) { asked = null; return null }
    return a
  }

  private fun ask(seq: Int, playing: Boolean?, item: MediaItem?) {
    asked = Asked(seq, playing, item ?: pending()?.item, SystemClock.elapsedRealtime() + ANSWER_MS)
    Bridge.main.removeCallbacks(recheck)
    Bridge.main.postDelayed(recheck, ANSWER_MS + 50)
  }

  private fun shown(r: Reading): MediaItem? {
    val id = r.id ?: return Catalogue.place(context)?.let { Catalogue.item(context, it) }
    val meta = MediaMetadata.Builder()
      .setTitle(r.title)
      .setArtist(r.subtitle)
      .setArtworkUri(r.art?.let { Uri.parse(it) })
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
      .build()
    return MediaItem.Builder().setMediaId(id).setMediaMetadata(meta).build()
  }

  override fun getState(): State {
    val r = Bridge.reading
    val a = pending()
    val item = a?.item ?: chosen ?: shown(r)
    val wanted = a?.playing
    val playing = wanted ?: (r.status == "playing" || r.status == "loading")
    val state = when {
      item == null -> Player.STATE_IDLE
      wanted == true && r.status != "playing" -> Player.STATE_BUFFERING
      r.status == "idle" || r.status == "error" -> Player.STATE_IDLE
      r.status == "loading" -> Player.STATE_BUFFERING
      else -> Player.STATE_READY
    }
    val builder = State.Builder()
      .setAvailableCommands(COMMANDS)
      .setPlayWhenReady(playing && state != Player.STATE_IDLE, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      .setPlaybackState(state)
      .setPlaybackParameters(PlaybackParameters(r.speed))
    // no length and no position: the session shows the chapter and what is done with it, not a place in time
    if (item != null) builder.setPlaylist(listOf(MediaItemData.Builder(item.mediaId).setMediaItem(item).setMediaMetadata(item.mediaMetadata).build()))
    if (r.status == "error" && wanted != true) builder.setPlayerError(PlaybackException(r.error, null, PlaybackException.ERROR_CODE_REMOTE_ERROR))
    return builder.build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    val item = chosen
    chosen = null
    val seq = Bridge.send(context, if (playWhenReady) "play" else "pause", request(item))
    ask(seq, playWhenReady, item)
    return Futures.immediateVoidFuture()
  }

  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleStop(): ListenableFuture<*> {
    chosen = null
    ask(Bridge.send(context, "stop"), false, null)
    return Futures.immediateVoidFuture()
  }

  override fun handleSetMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> {
    val item = mediaItems.getOrNull(if (startIndex in mediaItems.indices) startIndex else 0) ?: return Futures.immediateVoidFuture()
    val r = Bridge.reading
    // a reading that is going moves to the new item at once; otherwise the item waits for Play
    if (pending()?.playing ?: (r.status == "playing" || r.status == "loading")) ask(Bridge.send(context, "play", request(item)), true, item)
    else chosen = item
    return Futures.immediateVoidFuture()
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    when (seekCommand) {
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> Bridge.send(context, "next")
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> Bridge.send(context, "previous")
    }
    return Futures.immediateVoidFuture()
  }

  override fun handleSetPlaybackParameters(playbackParameters: PlaybackParameters): ListenableFuture<*> {
    Bridge.send(context, "speed", mapOf("speed" to playbackParameters.speed.toDouble()))
    return Futures.immediateVoidFuture()
  }

  override fun handleRelease(): ListenableFuture<*> {
    Bridge.main.removeCallbacks(recheck)
    return Futures.immediateVoidFuture()
  }

  /** A chosen item as the command names it: its id, or the words of a search ("play John 3"). */
  private fun request(item: MediaItem?): Map<String, Any?> {
    val id = item?.mediaId ?: return emptyMap()
    return if (id.startsWith(QUERY)) mapOf("query" to id.removePrefix(QUERY)) else mapOf("id" to id)
  }

  companion object {
    /** The id of an item that stands for a search until JavaScript has found what it names. */
    const val QUERY = "q:"
    /** How long an unanswered command is shown as done: a start of JavaScript from nothing takes a few seconds. */
    private const val ANSWER_MS = 20_000L
    private val COMMANDS: Player.Commands = Player.Commands.Builder().addAll(
      Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PREPARE, Player.COMMAND_STOP,
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS,
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_METADATA, Player.COMMAND_GET_TIMELINE,
      Player.COMMAND_SET_SPEED_AND_PITCH,
    ).build()
  }
}
