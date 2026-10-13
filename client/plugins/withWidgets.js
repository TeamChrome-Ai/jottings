// The Android home-screen widgets (src/widgets): react-native-android-widget's own config plugin, given app.json's
// widget list, plus the three things it leaves out.
//
// - A smallest size below the default one. The library writes only minWidth/minHeight, which are both the size a widget
//   opens at and the smallest it resizes to; `minResizeWidth` / `minResizeHeight` in a widget's entry are added here,
//   so the verse opens at 4 x 2 and still shrinks to 3 x 2, the streak opens at 2 x 2 and shrinks to a 4 x 1 strip.
// - Previews that stay sharp. The library copies a preview into drawable/, which Android reads as mdpi and scales up
//   about threefold on a phone; here it moves to drawable-nodpi/, and a `-dark` sibling of the file (drawn by
//   scripts/widget-previews.mjs) goes to drawable-night-nodpi/ for the picker in dark mode.
// - A redraw when the local day turns, so the verse changes and a missed day shows as a lapse without the app running.
//   WidgetMidnight sets an inexact alarm for the next local midnight (a 10 minute window, which needs no exact-alarm
//   permission), re-armed each time Android updates a widget (added, after a reboot or an app update) and whenever the
//   clock or the time zone changes; it cancels itself once no widget is left on the home screen.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')
const withAndroidWidgets = require('react-native-android-widget/app.plugin').default

const provider = (pkg, name) => `package ${pkg};

import android.appwidget.AppWidgetManager;
import android.content.Context;

import com.reactnativeandroidwidget.RNWidgetProvider;

/** react-native-android-widget's provider, keeping the midnight redraw armed (plugins/withWidgets.js). */
public class ${name} extends RNWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        super.onUpdate(context, manager, ids);
        WidgetMidnight.arm(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        WidgetMidnight.arm(context);
    }
}
`

const midnight = (pkg, names) => `package ${pkg};

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import com.reactnativeandroidwidget.RNWidgetJsCommunication;

import java.util.Calendar;

/** Redraws the widgets when the local day turns: at the next local midnight, and when the clock or time zone changes. */
public class WidgetMidnight extends BroadcastReceiver {
    private static final Class<?>[] WIDGETS = { ${names.map(n => `${n}.class`).join(', ')} };
    /** Android 12 widens any shorter window of an inexact alarm to 10 minutes; the same on every version. */
    private static final long WINDOW_MS = 10 * 60 * 1000;

    @Override
    public void onReceive(Context context, Intent intent) {
        for (Class<?> widget : WIDGETS) RNWidgetJsCommunication.requestWidgetUpdate(context, widget.getSimpleName());
        arm(context);
    }

    /** Sets (or moves) the alarm to the next local midnight while a widget is on the home screen; cancels it otherwise. */
    public static void arm(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (alarms == null || manager == null) return;
        PendingIntent tick = PendingIntent.getBroadcast(context, 0, new Intent(context, WidgetMidnight.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean placed = false;
        for (Class<?> widget : WIDGETS) placed |= manager.getAppWidgetIds(new ComponentName(context, widget)).length > 0;
        if (!placed) { alarms.cancel(tick); return; }
        // set from the calendar's fields, so a daylight-saving change on the way still lands on the wall clock's midnight
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_YEAR, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        alarms.setWindow(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), WINDOW_MS, tick);
    }
}
`

module.exports = function withWidgets(config, params) {
  const pkg = `${config.android.package}.widget`
  const names = params.widgets.map(w => w.name)
  // registered before the library's plugin: Expo runs dangerous mods last-registered first, so this one runs after
  // the library has written its files, and replaces or amends them
  config = withDangerousMod(config, ['android', c => {
    const main = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main')
    const res = path.join(main, 'res')
    for (const w of params.widgets) {
      const id = w.name.toLowerCase()
      const xmlFile = path.join(res, 'xml', `widgetprovider_${id}.xml`)
      const resize = ['minResizeWidth', 'minResizeHeight'].filter(k => w[k]).map(k => `\n    android:${k}="${w[k]}"`).join('')
      fs.writeFileSync(xmlFile, fs.readFileSync(xmlFile, 'utf8').replace(/(android:minHeight="[^"]*")/, `$1${resize}`))
      if (w.previewImage) {
        const file = `${id}_preview${path.extname(w.previewImage)}`
        fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true })
        fs.renameSync(path.join(res, 'drawable', file), path.join(res, 'drawable-nodpi', file))
        const dark = path.resolve(c.modRequest.projectRoot, w.previewImage.replace(/(\.\w+)$/, '-dark$1'))
        if (fs.existsSync(dark)) {
          fs.mkdirSync(path.join(res, 'drawable-night-nodpi'), { recursive: true })
          fs.copyFileSync(dark, path.join(res, 'drawable-night-nodpi', file))
        }
      }
    }
    const java = path.join(main, 'java', ...pkg.split('.'))
    for (const name of names) fs.writeFileSync(path.join(java, `${name}.java`), provider(pkg, name))
    fs.writeFileSync(path.join(java, 'WidgetMidnight.java'), midnight(pkg, names))
    return c
  }])
  config = withAndroidWidgets(config, params)
  return withAndroidManifest(config, c => {
    const app = c.modResults.manifest.application[0]
    app.receiver = (app.receiver ?? []).filter(r => r.$['android:name'] !== '.widget.WidgetMidnight')
    app.receiver.push({
      $: { 'android:name': '.widget.WidgetMidnight', 'android:exported': 'false' },
      'intent-filter': [{ action: ['android.intent.action.TIME_SET', 'android.intent.action.TIMEZONE_CHANGED'].map(a => ({ $: { 'android:name': a } })) }],
    })
    return c
  })
}
