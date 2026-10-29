package org.nyao.legacy;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

/** Держит музыку живой в фоне и показывает уведомление с кнопками */
public class PlayerService extends Service {
    private static PlayerService inst;

    static void update(Context ctx) {
        if (inst != null) inst.show();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
    }

    @Override
    public void onDestroy() {
        inst = null;
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Player p = Player.get(this);
        String a = intent != null ? intent.getAction() : null;
        if ("toggle".equals(a)) p.toggle();
        else if ("next".equals(a)) p.next();
        else if ("prev".equals(a)) p.prev();
        else if ("close".equals(a)) {
            p.stop();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        show();
        return START_NOT_STICKY;
    }

    private PendingIntent action(String a, int req) {
        return PendingIntent.getService(this, req, new Intent(this, PlayerService.class).setAction(a), PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void show() {
        Player p = Player.get(this);
        Track t = p.current();
        if (t == null) return;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, PlayerActivity.class), PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(t.title)
                .setContentText(p.error != null ? p.error : t.artist)
                .setContentIntent(open)
                .setOngoing(p.playing())
                .setDeleteIntent(action("close", 4))
                .addAction(android.R.drawable.ic_media_previous, "", action("prev", 1))
                .addAction(p.playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, "", action("toggle", 2))
                .addAction(android.R.drawable.ic_media_next, "", action("next", 3));
        Notification n = b.build();
        if (p.playing() || p.loading()) startForeground(1, n);
        else {
            stopForeground(false);
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(1, n);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
