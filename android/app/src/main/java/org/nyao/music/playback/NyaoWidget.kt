package org.nyao.music.playback

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.compose.ui.graphics.toArgb
import org.nyao.music.MainActivity
import org.nyao.music.R
import org.nyao.music.data.Repo

/**
 * Стиль виджетов — выбирается в настройках («Стиль виджетов»); «auto» — по теме приложения.
 * Макеты — на холсте Nyao (страница andwg): по два варианта на тему.
 */
enum class WidgetStyle(val id: String, val title: String, val note: String) {
    EXP_A("expA", "Expressive · тональный", "Плашка в тоне акцента, кнопка-печенька"),
    EXP_B("expB", "Expressive · обложка", "Обложка на весь виджет"),
    MONO_A("monoA", "Mono · крупный текст", "Без обложки, крупное название"),
    MONO_B("monoB", "Mono · плашки", "Серая плашка, кнопки-таблетки"),
    GLASS_A("glassA", "Glass · стекло", "Светлое стекло над обоями"),
    GLASS_B("glassB", "Glass · размытая обложка", "Размытая обложка под стеклом");

    val mono get() = this == MONO_A || this == MONO_B
    val glass get() = this == GLASS_A || this == GLASS_B

    companion object {
        fun of(id: String?, theme: String): WidgetStyle = entries.firstOrNull { it.id == id } ?: byTheme(theme)
        fun byTheme(theme: String) = when (theme) {
            "mono" -> MONO_A
            "glass" -> GLASS_A
            else -> EXP_A
        }
    }
}

/** Что показывает виджет */
data class WidgetState(
    val title: String = "Nyao Music",
    val artist: String = "Нажми, чтобы открыть",
    val playing: Boolean = false,
    val cover: Bitmap? = null,
    val live: Boolean = false,
    val liked: Boolean = false,
    /** 0..1, null — неизвестно */
    val progress: Float? = null,
    /** Строки текста песни: прошлая, текущая, следующая (для виджета 4×3) */
    val lines: Triple<String?, String, String?>? = null,
)

/** Размер виджета по клеткам */
enum class WidgetSize { S41, S42, S22, S43 }

/**
 * Виджет плеера: 4×1, 4×2, 2×2 и 4×3 (со строкой текста) — один виджет, раскладка по размеру.
 * Обновляет его сервис воспроизведения; пока сервис не запущен, кнопки открывают приложение.
 */
class NyaoWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_TOGGLE = "org.nyao.music.widget.TOGGLE"
        const val ACTION_NEXT = "org.nyao.music.widget.NEXT"
        const val ACTION_PREV = "org.nyao.music.widget.PREV"
        const val ACTION_LIKE = "org.nyao.music.widget.LIKE"
        const val ACTION_WAVE = "org.nyao.music.widget.WAVE"
        /** Виджет растянули до 4×3 — сервису пора найти текст песни */
        const val ACTION_REFRESH = "org.nyao.music.widget.REFRESH"
        /** Открыть приложение и сразу запустить «Мою волну» (виджет волны, пока музыка не играет) */
        const val ACTION_OPEN_WAVE = "org.nyao.music.action.WAVE"

        @Volatile var last = WidgetState()
            private set

        fun style(): WidgetStyle = runCatching {
            val s = Repo.prefs.settings.value
            WidgetStyle.of(s.widgetStyle, s.theme)
        }.getOrDefault(WidgetStyle.EXP_A)

        /** Акцент приложения (с «Из обложки» — текущий цвет плеера) */
        internal fun accent(): Pair<Int, Int> = runCatching {
            val p = org.nyao.music.ui.theme.Accent.palette
            p.a.toArgb() to p.onA.toArgb()
        }.getOrDefault(0xFFCBB8FF.toInt() to 0xFF21005D.toInt())

        internal fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
            ctx, 10,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        internal fun command(ctx: Context, action: String, code: Int): PendingIntent = PendingIntent.getService(
            ctx, code,
            Intent(ctx, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        /** Размер по параметрам виджета (в портретной ориентации ширина — минимальная, высота — максимальная) */
        fun sizeOf(opts: Bundle?): Triple<WidgetSize, Int, Int> {
            val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)?.takeIf { it > 0 } ?: 300
            val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)?.takeIf { it > 0 } ?: 90
            val size = when {
                w < 200 && h >= 110 -> WidgetSize.S22
                h < 110 -> WidgetSize.S41
                h < 220 -> WidgetSize.S42
                else -> WidgetSize.S43
            }
            return Triple(size, w, h)
        }

        private fun ids(ctx: Context, mgr: AppWidgetManager) = mgr.getAppWidgetIds(ComponentName(ctx, NyaoWidget::class.java))

        /** Есть ли на рабочем столе виджет 4×3 (ему нужен текст песни) */
        fun wantsLyrics(ctx: Context): Boolean = runCatching {
            val mgr = AppWidgetManager.getInstance(ctx)
            ids(ctx, mgr).any { sizeOf(mgr.getAppWidgetOptions(it)).first == WidgetSize.S43 }
        }.getOrDefault(false)

        @Volatile private var anyAt = 0L
        @Volatile private var anyCached = false

        /** Стоит ли хоть один виджет (ответ помнится 10 секунд — сервис спрашивает каждую секунду) */
        fun hasAny(ctx: Context): Boolean {
            val now = System.currentTimeMillis()
            if (now - anyAt < 10_000) return anyCached
            anyCached = runCatching {
                val mgr = AppWidgetManager.getInstance(ctx)
                ids(ctx, mgr).isNotEmpty() || mgr.getAppWidgetIds(ComponentName(ctx, NyaoWaveWidget::class.java)).isNotEmpty()
            }.getOrDefault(false)
            anyAt = now
            return anyCached
        }

        /** Виджет добавили или убрали — пересчитать сразу */
        fun forget() {
            anyAt = 0L
        }

        /** Обновить виджеты (зовёт сервис воспроизведения). onlyLyrics — только 4×3 (сменилась строка текста) */
        fun push(ctx: Context, s: WidgetState, onlyLyrics: Boolean = false) {
            last = s
            val mgr = AppWidgetManager.getInstance(ctx)
            val st = style()
            for (id in ids(ctx, mgr)) {
                val opts = runCatching { mgr.getAppWidgetOptions(id) }.getOrNull()
                if (onlyLyrics && sizeOf(opts).first != WidgetSize.S43) continue
                runCatching { mgr.updateAppWidget(id, WidgetViews.player(ctx, st, s, opts)) }
            }
            if (!onlyLyrics) NyaoWaveWidget.refresh(ctx)
        }

        /** Стиль поменяли в настройках — перерисовать всё */
        fun refreshAll(ctx: Context) = push(ctx, last)
    }

    override fun onEnabled(context: Context) = forget()
    override fun onDeleted(context: Context, appWidgetIds: IntArray) = forget()

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        forget()
        val st = style()
        for (id in ids) runCatching { manager.updateAppWidget(id, WidgetViews.player(context, st, last, manager.getAppWidgetOptions(id))) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        runCatching { manager.updateAppWidget(id, WidgetViews.player(context, style(), last, newOptions)) }
        // растянули до 4×3 — сервису нужен текст песни
        if (sizeOf(newOptions).first == WidgetSize.S43 && last.live) {
            runCatching { context.startService(Intent(context, PlaybackService::class.java).setAction(ACTION_REFRESH)) }
        }
    }
}

/** Виджет «Моя волна» 2×2: запускает волну (или ставит её на паузу) */
class NyaoWaveWidget : AppWidgetProvider() {
    companion object {
        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, NyaoWaveWidget::class.java))
            if (ids.isEmpty()) return
            runCatching { mgr.updateAppWidget(ids, WidgetViews.wave(ctx, NyaoWidget.style(), NyaoWidget.last)) }
        }
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) = NyaoWidget.forget()

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        NyaoWidget.forget()
        runCatching { manager.updateAppWidget(ids, WidgetViews.wave(context, NyaoWidget.style(), NyaoWidget.last)) }
    }
}

/**
 * Сборка RemoteViews. Лаунчер применяет новые RemoteViews поверх старых, если макет тот же,
 * поэтому каждое свойство (видимость, цвет, фон) здесь задаётся всегда — иначе останется от прошлого стиля.
 */
internal object WidgetViews {
    private const val WHITE = 0xFFFFFFFF.toInt()

    private class Palette(
        val on: Int, val sub: Int, val icon: Int,
        val playBg: Int, val playTint: Int, val playIcon: Int,
        val progress: Int, val rest: Int,
    )

    private fun palette(st: WidgetStyle): Palette {
        val (acc, onAcc) = NyaoWidget.accent()
        return when (st) {
            WidgetStyle.EXP_A -> Palette(0xFFF1ECFF.toInt(), 0xB3F1ECFF.toInt(), 0xFFF1ECFF.toInt(), R.drawable.w_cookie, acc, onAcc, acc, 0x38F1ECFF)
            WidgetStyle.EXP_B -> Palette(WHITE, 0xCCFFFFFF.toInt(), WHITE, R.drawable.w_cookie, acc, onAcc, acc, 0x4DFFFFFF)
            WidgetStyle.MONO_A -> Palette(0xFFF2F2F3.toInt(), 0xFF9A9AA2.toInt(), 0xFFF2F2F3.toInt(), R.drawable.w_circle, WHITE, 0xFF0B0B0C.toInt(), WHITE, 0x29FFFFFF)
            WidgetStyle.MONO_B -> Palette(0xFFF2F2F3.toInt(), 0xFF9A9AA2.toInt(), 0xFFF2F2F3.toInt(), R.drawable.w_circle, WHITE, 0xFF0B0B0C.toInt(), WHITE, 0xFF2E2E32.toInt())
            WidgetStyle.GLASS_A -> Palette(WHITE, 0xD9FFFFFF.toInt(), WHITE, R.drawable.w_circle, 0xEBFFFFFF.toInt(), 0xFF1A1726.toInt(), WHITE, 0x4DFFFFFF)
            WidgetStyle.GLASS_B -> Palette(WHITE, 0xD9FFFFFF.toInt(), WHITE, R.drawable.w_circle_glass, 0, WHITE, WHITE, 0x4DFFFFFF)
        }
    }

    /** Тон плашки Expressive · тональный — акцент, утопленный в почти чёрный */
    private fun tonal(acc: Int): Int {
        val k = 0.2f
        fun ch(shift: Int, base: Int) = (((acc shr shift) and 255) * k + base * (1 - k)).toInt()
        return (0xFF shl 24) or (ch(16, 0x14) shl 16) or (ch(8, 0x12) shl 8) or ch(0, 0x1C)
    }

    private fun RemoteViews.show(id: Int, on: Boolean) = setViewVisibility(id, if (on) View.VISIBLE else View.GONE)
    private fun RemoteViews.tint(id: Int, color: Int) = setInt(id, "setColorFilter", color)

    private fun layoutFor(st: WidgetStyle, size: WidgetSize): Int = when (size) {
        WidgetSize.S41 -> R.layout.widget_41
        WidgetSize.S42 -> when (st) {
            WidgetStyle.EXP_B -> R.layout.widget_42_over
            WidgetStyle.MONO_B, WidgetStyle.GLASS_B -> R.layout.widget_42_side
            else -> R.layout.widget_42_stack
        }
        WidgetSize.S22 -> if (st == WidgetStyle.MONO_B || st == WidgetStyle.GLASS_B) R.layout.widget_22_stage else R.layout.widget_22_corner
        WidgetSize.S43 -> R.layout.widget_43
    }

    /** Фон: плашка нужного цвета, стекло или картинка (обложка во весь виджет / размытая обложка) */
    private fun RemoteViews.background(ctx: Context, st: WidgetStyle, s: WidgetState, size: WidgetSize, wDp: Int, hDp: Int) {
        val pill = size == WidgetSize.S41
        val radius = if (pill) hDp / 2f else if (st == WidgetStyle.MONO_B) 24f else 28f
        val art = when (st) {
            WidgetStyle.EXP_B -> WidgetArt.artBackground(s.cover, wDp, hDp, radius, when (size) {
                WidgetSize.S41 -> WidgetArt.Scrim.LEFT
                WidgetSize.S43 -> WidgetArt.Scrim.FULL
                else -> WidgetArt.Scrim.BOTTOM
            })
            WidgetStyle.GLASS_B -> WidgetArt.blurBackground(s.cover, wDp, hDp, radius)
            else -> null
        }
        setImageViewResource(R.id.w_bg, 0)
        if (art != null) {
            setImageViewBitmap(R.id.w_bg, art)
            tint(R.id.w_bg, 0)
            return
        }
        val (acc, _) = NyaoWidget.accent()
        val (res, color) = when (st) {
            WidgetStyle.EXP_A -> (if (pill) R.drawable.w_bg_r44 else R.drawable.w_bg_r28) to tonal(acc)
            WidgetStyle.MONO_A -> (if (pill) R.drawable.w_bg_mono_r44 else R.drawable.w_bg_mono_r28) to 0
            WidgetStyle.MONO_B -> R.drawable.w_bg_r24 to 0xFF141416.toInt()
            WidgetStyle.GLASS_A -> (if (pill) R.drawable.w_bg_glass_r44 else R.drawable.w_bg_glass_r28) to 0
            // обложки ещё нет — тёмная плашка того же стиля
            WidgetStyle.EXP_B -> (if (pill) R.drawable.w_bg_r44 else R.drawable.w_bg_r28) to 0xFF2A2732.toInt()
            WidgetStyle.GLASS_B -> (if (pill) R.drawable.w_bg_glass_r44 else R.drawable.w_bg_glass_r28) to 0
        }
        setImageViewResource(R.id.w_bg, res)
        tint(R.id.w_bg, color)
    }

    private fun RemoteViews.coverInto(ctx: Context, id: Int, src: Bitmap?, px: Int, radius: Float, gray: Boolean, aspect: Float = 1f) {
        val bmp = WidgetArt.cover(src, px, radius, gray, aspect)
        if (bmp != null) setImageViewBitmap(id, bmp) else setImageViewResource(id, R.drawable.ic_launcher_foreground)
        tint(id, 0)
    }

    private fun RemoteViews.titles(st: WidgetStyle, p: Palette, s: WidgetState, big: Boolean = st == WidgetStyle.MONO_A) {
        setTextViewText(R.id.w_title, s.title)
        setTextViewText(R.id.w_title_big, s.title)
        setTextViewText(R.id.w_artist, s.artist)
        setTextColor(R.id.w_title, p.on)
        setTextColor(R.id.w_title_big, p.on)
        setTextColor(R.id.w_artist, p.sub)
        show(R.id.w_title, !big)
        show(R.id.w_title_big, big)
        show(R.id.w_artist, true)
    }

    /** Круглая кнопка «играть»: подложка (печенька, круг, стекло) и значок */
    private fun RemoteViews.playButton(prefix: Int, bg: Int, icon: Int, p: Palette, s: WidgetState) {
        setImageViewResource(bg, p.playBg)
        tint(bg, p.playTint)
        setImageViewResource(icon, if (s.playing) R.drawable.ic_w_pause else R.drawable.ic_w_play)
        tint(icon, p.playIcon)
        setContentDescription(prefix, if (s.playing) "Пауза" else "Играть")
    }

    private fun RemoteViews.pills(s: WidgetState, withSides: Boolean) {
        setImageViewResource(R.id.w_pplay, if (s.playing) R.drawable.ic_w_pause else R.drawable.ic_w_play)
        tint(R.id.w_pplay, 0xFF0B0B0C.toInt())
        setContentDescription(R.id.w_pplay, if (s.playing) "Пауза" else "Играть")
        if (withSides) {
            tint(R.id.w_pprev, 0xFFF2F2F3.toInt())
            tint(R.id.w_pnext, 0xFFF2F2F3.toInt())
        }
    }

    private fun RemoteViews.progressInto(st: WidgetStyle, p: Palette, s: WidgetState, wDp: Int, hDp: Int) {
        val line = when (st) {
            WidgetStyle.MONO_A -> 3f
            WidgetStyle.EXP_A -> 3f
            else -> 4f
        }
        setImageViewBitmap(R.id.w_progress, WidgetArt.progress(s.progress ?: 0f, wDp, hDp, p.progress, p.rest, st == WidgetStyle.EXP_A, line))
    }

    private fun RemoteViews.clicks(ctx: Context, s: WidgetState, ids: Map<String, List<Int>>) {
        val open = NyaoWidget.openApp(ctx)
        ids["open"]?.forEach { setOnClickPendingIntent(it, open) }
        fun cmd(action: String, code: Int) = if (s.live) NyaoWidget.command(ctx, action, code) else open
        ids["toggle"]?.forEach { setOnClickPendingIntent(it, cmd(NyaoWidget.ACTION_TOGGLE, 11)) }
        ids["next"]?.forEach { setOnClickPendingIntent(it, cmd(NyaoWidget.ACTION_NEXT, 12)) }
        ids["prev"]?.forEach { setOnClickPendingIntent(it, cmd(NyaoWidget.ACTION_PREV, 13)) }
        ids["like"]?.forEach { setOnClickPendingIntent(it, cmd(NyaoWidget.ACTION_LIKE, 14)) }
    }

    private fun RemoteViews.heart(p: Palette, s: WidgetState, visible: Boolean) {
        show(R.id.w_heart, visible)
        setImageViewResource(R.id.w_heart, if (s.liked) R.drawable.ic_w_heart_on else R.drawable.ic_w_heart)
        tint(R.id.w_heart, p.icon)
        setContentDescription(R.id.w_heart, if (s.liked) "Убрать из «Мне нравится»" else "Мне нравится")
    }

    fun player(ctx: Context, st: WidgetStyle, s: WidgetState, opts: Bundle?): RemoteViews {
        val (size, wDp, hDp) = NyaoWidget.sizeOf(opts)
        val layout = layoutFor(st, size)
        val v = RemoteViews(ctx.packageName, layout)
        val p = palette(st)
        v.background(ctx, st, s, size, wDp, hDp)
        val gray = st == WidgetStyle.MONO_B
        when (layout) {
            R.layout.widget_41 -> {
                val cover = st != WidgetStyle.EXP_B && st != WidgetStyle.MONO_A
                v.show(R.id.w_cover, cover)
                v.show(R.id.w_lpad, !cover)
                if (cover) v.coverInto(ctx, R.id.w_cover, s.cover, 192, if (st == WidgetStyle.MONO_B) 0.22f else 0.5f, gray)
                v.titles(st, p, s)
                val pills = st == WidgetStyle.MONO_B
                v.show(R.id.w_controls, !pills)
                v.show(R.id.w_pills, pills)
                val sides = st == WidgetStyle.EXP_B
                v.show(R.id.w_prev, sides)
                v.show(R.id.w_next, sides)
                v.show(R.id.w_next_a, !sides)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.tint(R.id.w_next_a, if (st == WidgetStyle.MONO_A) p.sub else p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.pills(s, withSides = false)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover),
                    "toggle" to listOf(R.id.w_play_box, R.id.w_pplay),
                    "next" to listOf(R.id.w_next, R.id.w_next_a),
                    "prev" to listOf(R.id.w_prev),
                ))
            }
            R.layout.widget_42_stack -> {
                val cover = st != WidgetStyle.MONO_A
                v.show(R.id.w_cover, cover)
                if (cover) v.coverInto(ctx, R.id.w_cover, s.cover, 228, if (st == WidgetStyle.GLASS_A) 0.24f else 0.29f, false)
                v.titles(st, p, s)
                v.heart(p, s, st == WidgetStyle.EXP_A)
                v.progressInto(st, p, s, 150, 12)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover),
                    "toggle" to listOf(R.id.w_play_box),
                    "next" to listOf(R.id.w_next),
                    "prev" to listOf(R.id.w_prev),
                    "like" to listOf(R.id.w_heart),
                ))
            }
            R.layout.widget_42_over -> {
                v.titles(st, p, s)
                v.progressInto(st, p, s, (wDp - 190).coerceAtLeast(80), 10)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root),
                    "toggle" to listOf(R.id.w_play_box),
                    "next" to listOf(R.id.w_next),
                    "prev" to listOf(R.id.w_prev),
                ))
            }
            R.layout.widget_42_side -> {
                v.coverInto(ctx, R.id.w_cover, s.cover, 360, if (gray) 0.11f else 0.14f, gray)
                v.titles(st, p, s)
                v.progressInto(st, p, s, (wDp - 182).coerceAtLeast(80), 8)
                val pills = st == WidgetStyle.MONO_B
                v.show(R.id.w_controls, !pills)
                v.show(R.id.w_pills, pills)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.pills(s, withSides = true)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover),
                    "toggle" to listOf(R.id.w_play_box, R.id.w_pplay),
                    "next" to listOf(R.id.w_next, R.id.w_pnext),
                    "prev" to listOf(R.id.w_prev, R.id.w_pprev),
                ))
            }
            R.layout.widget_22_corner -> {
                val cover = st == WidgetStyle.EXP_A || st == WidgetStyle.GLASS_A
                val topPlay = st == WidgetStyle.EXP_A
                val bigTop = st == WidgetStyle.MONO_A
                v.show(R.id.w_cover, cover)
                if (cover) v.coverInto(ctx, R.id.w_cover, s.cover, 228, if (st == WidgetStyle.GLASS_A) 0.22f else 0.29f, false)
                v.show(R.id.w_title_top, bigTop)
                v.setTextViewText(R.id.w_title_top, s.title)
                v.setTextColor(R.id.w_title_top, p.on)
                v.titles(st, p, s, big = false)
                // Mono · крупный текст: название крупно сверху, внизу — только исполнитель
                v.show(R.id.w_title, !bigTop)
                v.show(R.id.w_play_top_box, topPlay)
                v.show(R.id.w_play_box, !topPlay)
                v.playButton(R.id.w_play_top_box, R.id.w_play_top_bg, R.id.w_play_top, p, s)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover),
                    "toggle" to listOf(R.id.w_play_box, R.id.w_play_top_box),
                ))
            }
            R.layout.widget_22_stage -> {
                val fill = st == WidgetStyle.MONO_B
                v.show(R.id.w_cover_fill, fill)
                v.show(R.id.w_cover, !fill)
                if (fill) {
                    // обложка во всю ширину: место под ней — виджет минус отступы и ряд кнопок
                    val wAvail = (wDp - 20f).coerceAtLeast(40f)
                    val hAvail = (hDp - 20f - 58f).coerceAtLeast(40f)
                    v.coverInto(ctx, R.id.w_cover_fill, s.cover, 300, 16f / minOf(wAvail, hAvail), true, wAvail / hAvail)
                } else {
                    v.coverInto(ctx, R.id.w_cover, s.cover, 252, 0.21f, false)
                }
                v.show(R.id.w_controls, !fill)
                v.show(R.id.w_pills, fill)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.pills(s, withSides = true)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover, R.id.w_cover_fill),
                    "toggle" to listOf(R.id.w_play_box, R.id.w_pplay),
                    "next" to listOf(R.id.w_next, R.id.w_pnext),
                    "prev" to listOf(R.id.w_prev, R.id.w_pprev),
                ))
            }
            else -> {
                // 4×3 со строкой текста
                val cover = st != WidgetStyle.EXP_B && st != WidgetStyle.MONO_A
                v.show(R.id.w_cover, cover)
                if (cover) v.coverInto(ctx, R.id.w_cover, s.cover, 180, if (gray) 0.21f else 0.27f, gray)
                v.titles(st, p, s, big = false)
                if (st == WidgetStyle.MONO_A) {
                    // строка «Название · Исполнитель» мелко, как в макете
                    v.setTextViewText(R.id.w_title, if (s.artist.isNotBlank()) "${s.title} · ${s.artist}" else s.title)
                    v.setTextViewTextSize(R.id.w_title, TypedValue.COMPLEX_UNIT_SP, 13f)
                    v.setTextColor(R.id.w_title, p.sub)
                    v.show(R.id.w_artist, false)
                } else {
                    v.setTextViewTextSize(R.id.w_title, TypedValue.COMPLEX_UNIT_SP, 16f)
                }
                v.heart(p, s, st != WidgetStyle.MONO_B)
                val plate = st == WidgetStyle.MONO_B
                v.setInt(R.id.w_lyrics, "setBackgroundResource", if (plate) R.drawable.w_plate_r18 else 0)
                val pad = if (plate) (16 * ctx.resources.displayMetrics.density).toInt() else 0
                v.setViewPadding(R.id.w_lyrics, pad, if (plate) pad * 7 / 8 else 0, pad, if (plate) pad * 7 / 8 else 0)
                val lines = s.lines
                val dim = if (st.mono) 0xFF6E6E76.toInt() else (p.on and 0x00FFFFFF) or 0x73000000
                val next = if (st.mono) 0xFF8A8A92.toInt() else (p.on and 0x00FFFFFF) or 0x99000000.toInt()
                v.setTextColor(R.id.w_line_prev, dim)
                v.setTextColor(R.id.w_line_next, next)
                if (lines != null) {
                    v.setTextViewText(R.id.w_line_prev, lines.first ?: "")
                    v.show(R.id.w_line_prev, !lines.first.isNullOrBlank())
                    v.setTextViewText(R.id.w_line_cur, lines.second)
                    v.setTextColor(R.id.w_line_cur, p.on)
                    v.setTextViewText(R.id.w_line_next, lines.third ?: "")
                    v.show(R.id.w_line_next, !lines.third.isNullOrBlank())
                } else {
                    v.show(R.id.w_line_prev, false)
                    v.setTextViewText(R.id.w_line_cur, if (s.live) "Текста для этого трека нет — просто слушаем" else "Здесь будет строка текста песни")
                    v.setTextColor(R.id.w_line_cur, dim)
                    v.show(R.id.w_line_next, false)
                }
                v.progressInto(st, p, s, 150, 12)
                val pills = st == WidgetStyle.MONO_B
                v.show(R.id.w_controls, !pills)
                v.show(R.id.w_pills, pills)
                v.tint(R.id.w_prev, p.icon)
                v.tint(R.id.w_next, p.icon)
                v.playButton(R.id.w_play_box, R.id.w_play_bg, R.id.w_play, p, s)
                v.pills(s, withSides = true)
                v.clicks(ctx, s, mapOf(
                    "open" to listOf(R.id.w_root, R.id.w_cover, R.id.w_lyrics),
                    "toggle" to listOf(R.id.w_play_box, R.id.w_pplay),
                    "next" to listOf(R.id.w_next, R.id.w_pnext),
                    "prev" to listOf(R.id.w_prev, R.id.w_pprev),
                    "like" to listOf(R.id.w_heart),
                ))
            }
        }
        return v
    }

    private val MOODS = mapOf("active" to "Бодрое", "fun" to "Весёлое", "calm" to "Спокойное", "sad" to "Грустное")
    private val CHARS = mapOf("any" to "Всё", "favorite" to "Любимое", "discover" to "Незнакомое", "popular" to "Популярное")

    fun wave(ctx: Context, st: WidgetStyle, s: WidgetState): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_wave)
        val (acc, onAcc) = NyaoWidget.accent()
        val settings = runCatching { Repo.prefs.settings.value }.getOrNull()
        val sub = settings?.mood?.let { MOODS[it] } ?: settings?.diversity?.let { CHARS[it] } ?: "Любимое"
        val waveOn = s.live && s.playing && runCatching { Repo.mode.value == Repo.Mode.WAVE }.getOrDefault(false)
        // фон, цвет надписей, подложка и значок кнопки
        data class W(val bg: Int, val bgTint: Int, val text: Int, val sub: Int, val playBg: Int, val playTint: Int, val playIcon: Int)
        val w = when (st) {
            WidgetStyle.EXP_A -> W(R.drawable.w_bg_r28, acc, onAcc, (onAcc and 0x00FFFFFF) or 0xBF000000.toInt(), R.drawable.w_cookie, onAcc, acc)
            WidgetStyle.EXP_B -> W(R.drawable.w_bg_r28, 0xFF121016.toInt(), WHITE, 0xCCFFFFFF.toInt(), R.drawable.w_cookie, acc, onAcc)
            WidgetStyle.MONO_A -> W(R.drawable.w_bg_r28, WHITE, 0xFF0B0B0C.toInt(), 0xFF4A4A50.toInt(), R.drawable.w_circle, 0xFF0B0B0C.toInt(), WHITE)
            WidgetStyle.MONO_B -> W(R.drawable.w_bg_r24, 0xFF141416.toInt(), 0xFFF2F2F3.toInt(), 0xFFC8C8CE.toInt(), R.drawable.w_circle, WHITE, 0xFF0B0B0C.toInt())
            WidgetStyle.GLASS_A -> W(R.drawable.w_bg_glass_r28, 0, WHITE, 0xD9FFFFFF.toInt(), R.drawable.w_circle, 0xEBFFFFFF.toInt(), 0xFF1A1726.toInt())
            WidgetStyle.GLASS_B -> W(R.drawable.w_bg_wave_glass, 0, WHITE, WHITE, R.drawable.w_circle_glass, 0, WHITE)
        }
        v.setImageViewResource(R.id.w_bg, w.bg)
        v.tint(R.id.w_bg, w.bgTint)
        v.setTextColor(R.id.w_wave_title, w.text)
        v.setTextViewTextSize(R.id.w_wave_title, TypedValue.COMPLEX_UNIT_SP, if (st == WidgetStyle.MONO_A) 24f else 21f)
        v.setTextViewText(R.id.w_wave_sub, sub)
        v.setTextColor(R.id.w_wave_sub, w.sub)
        v.show(R.id.w_decor, st == WidgetStyle.EXP_B)
        v.show(R.id.w_wave_icon, st == WidgetStyle.GLASS_A)
        v.show(R.id.w_dot, st == WidgetStyle.MONO_B)
        v.tint(R.id.w_dot, acc)
        // Mono · плашки: настроение — в серой таблетке
        val pillSub = st == WidgetStyle.MONO_B
        val d = ctx.resources.displayMetrics.density
        v.setInt(R.id.w_wave_sub, "setBackgroundResource", if (pillSub) R.drawable.w_pill_grey else 0)
        v.setInt(R.id.w_wave_sub, "setGravity", if (pillSub) android.view.Gravity.CENTER else android.view.Gravity.START or android.view.Gravity.CENTER_VERTICAL)
        v.setViewPadding(R.id.w_wave_sub, if (pillSub) (10 * d).toInt() else 0, if (pillSub) (18 * d).toInt() else 0, if (pillSub) (10 * d).toInt() else 0, if (pillSub) (18 * d).toInt() else 0)
        v.setImageViewResource(R.id.w_play_bg, w.playBg)
        v.tint(R.id.w_play_bg, w.playTint)
        v.setImageViewResource(R.id.w_play, if (waveOn) R.drawable.ic_w_pause else R.drawable.ic_w_play)
        v.tint(R.id.w_play, w.playIcon)
        v.setContentDescription(R.id.w_play_box, if (waveOn) "Пауза" else "Запустить Мою волну")
        val action = if (s.live) {
            PendingIntent.getService(ctx, 15, Intent(ctx, PlaybackService::class.java).setAction(NyaoWidget.ACTION_WAVE), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else {
            PendingIntent.getActivity(
                ctx, 16,
                Intent(ctx, MainActivity::class.java).setAction(NyaoWidget.ACTION_OPEN_WAVE).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
        v.setOnClickPendingIntent(R.id.w_play_box, action)
        v.setOnClickPendingIntent(R.id.w_root, NyaoWidget.openApp(ctx))
        return v
    }
}
