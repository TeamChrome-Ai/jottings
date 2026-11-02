package expo.modules.readaloudclock

import android.os.Handler
import android.os.Looper
import android.view.Choreographer.FrameCallback
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.internal.ChoreographerProvider

/**
 * React Native runs the app's timers on frames. On phones the reading's timers stood still soon after the app left the
 * screen, with the read-aloud task held and the main thread still answering (reports #21 and #28). So while a headless
 * task is open, a frame not delivered within STAND_IN_MS is run from the main thread instead, once.
 */
internal object ReadingFrames : ChoreographerProvider {
  private const val STAND_IN_MS = 50L

  @Volatile var taskOpen = false
  @Volatile var stoodIn = 0
    private set
  @Volatile var inUse = false
    private set

  override fun getChoreographer(): ChoreographerProvider.Choreographer {
    UiThreadUtil.assertOnUiThread()
    inUse = true
    return StandIn()
  }

  private class StandIn(private val vsync: android.view.Choreographer = android.view.Choreographer.getInstance()) : ChoreographerProvider.Choreographer {
    private val main = Handler(Looper.getMainLooper())
    private val waiting = HashMap<FrameCallback, Frame>()
    // a vsync run just after a stand-in can carry an earlier time, and native animations count frames from it
    private var last = 0L
    private fun frameTime(t: Long) = maxOf(t, last).also { last = it }

    override fun postFrameCallback(callback: FrameCallback) {
      val frame = Frame(callback)
      synchronized(waiting) { waiting[callback] = frame }
      vsync.postFrameCallback(frame)
      if (taskOpen) main.postDelayed(frame, STAND_IN_MS)
    }

    override fun removeFrameCallback(callback: FrameCallback) {
      val frame = synchronized(waiting) { waiting.remove(callback) } ?: return
      vsync.removeFrameCallback(frame)
      main.removeCallbacks(frame)
    }

    private inner class Frame(private val callback: FrameCallback) : FrameCallback, Runnable {
      override fun doFrame(frameTimeNanos: Long) {
        if (!take()) return
        main.removeCallbacks(this)
        callback.doFrame(frameTime(frameTimeNanos))
      }

      override fun run() {
        if (!take()) return
        vsync.removeFrameCallback(this)
        stoodIn++
        callback.doFrame(frameTime(System.nanoTime()))
      }

      private fun take() = synchronized(waiting) { waiting.remove(callback, this) }
    }
  }
}
