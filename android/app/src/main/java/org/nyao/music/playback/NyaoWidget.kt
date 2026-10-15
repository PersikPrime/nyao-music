package org.nyao.music.playback

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews
import org.nyao.music.MainActivity
import org.nyao.music.R

/**
 * Виджет на рабочий стол: обложка, трек и кнопки. Обновляет его сервис воспроизведения;
 * пока сервис не запущен, кнопки просто открывают приложение.
 */
class NyaoWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_TOGGLE = "org.nyao.music.widget.TOGGLE"
        const val ACTION_NEXT = "org.nyao.music.widget.NEXT"
        const val ACTION_PREV = "org.nyao.music.widget.PREV"

        data class State(val title: String = "Nyao Music", val artist: String = "Нажми, чтобы открыть", val playing: Boolean = false, val cover: Bitmap? = null, val live: Boolean = false)

        @Volatile private var last = State()

        private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
            ctx, 10,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        private fun command(ctx: Context, action: String, code: Int): PendingIntent = PendingIntent.getService(
            ctx, code,
            Intent(ctx, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        private fun views(ctx: Context, s: State): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_player).apply {
            setTextViewText(R.id.w_title, s.title)
            setTextViewText(R.id.w_artist, s.artist)
            if (s.cover != null) setImageViewBitmap(R.id.w_cover, s.cover) else setImageViewResource(R.id.w_cover, R.drawable.ic_launcher_foreground)
            setImageViewResource(R.id.w_play, if (s.playing) R.drawable.ic_w_pause else R.drawable.ic_w_play)
            setContentDescription(R.id.w_play, if (s.playing) "Пауза" else "Играть")
            setOnClickPendingIntent(R.id.w_root, openApp(ctx))
            setOnClickPendingIntent(R.id.w_cover, openApp(ctx))
            if (s.live) {
                setOnClickPendingIntent(R.id.w_play, command(ctx, ACTION_TOGGLE, 11))
                setOnClickPendingIntent(R.id.w_next, command(ctx, ACTION_NEXT, 12))
                setOnClickPendingIntent(R.id.w_prev, command(ctx, ACTION_PREV, 13))
            } else {
                listOf(R.id.w_play, R.id.w_next, R.id.w_prev).forEach { setOnClickPendingIntent(it, openApp(ctx)) }
            }
        }

        /** Обновить все виджеты (зовёт сервис воспроизведения) */
        fun push(ctx: Context, s: State) {
            last = s
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, NyaoWidget::class.java))
            if (ids.isNotEmpty()) runCatching { mgr.updateAppWidget(ids, views(ctx, s)) }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        runCatching { manager.updateAppWidget(ids, views(context, last)) }
    }
}
