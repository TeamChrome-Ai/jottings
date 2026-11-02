package expo.modules.readaloudclock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * The device voice speaks from the phone's speech engine, another app's process, so off screen Android counted the app
 * idle and froze it mid-verse (report #36).
 */
class ReadingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(TITLE).orEmpty()
    val label = intent?.getStringExtra(LABEL).orEmpty()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java)?.createNotificationChannel(NotificationChannel(CHANNEL, label, NotificationManager.IMPORTANCE_LOW))
      Notification.Builder(this, CHANNEL)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = builder
      .setSmallIcon(if (icon != 0) icon else applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(label)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    else startForeground(ID, notification)
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "read_aloud"
    private const val ID = 1
    private const val TITLE = "title"
    private const val LABEL = "label"

    fun start(context: Context, title: String, label: String) {
      val intent = Intent(context, ReadingService::class.java).putExtra(TITLE, title).putExtra(LABEL, label)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      } catch (e: Exception) {
        // Android 12+ refuses it with the app in the background
        Log.w("ReadAloudClock", "could not start the device voice's service", e)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ReadingService::class.java))
    }
  }
}
