package org.nyao.music.ui.screens

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import org.nyao.music.data.Badge
import org.nyao.music.data.InboxItem
import org.nyao.music.data.ProfileLink
import org.nyao.music.data.UserCard
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.theme.NyaoColors

/** Профиль 0.100: форма аватара, цвет профиля, значки-печеньки, ссылки и баннер. То же на ПК: src/renderer/profile-ui.js */

val AVATAR_SHAPES = listOf("cookie" to "Печенька", "circle" to "Круг", "squircle" to "Скруглённый квадрат")
val PROFILE_COLORS = listOf("#C6B8FF", "#7CE0C3", "#FFB86B", "#FF8FB1", "#8FB4FF", "#FFD60A", "#FF6A5C", "#B8E05A")
const val DEFAULT_PROFILE_COLOR = "#C6B8FF"

fun avatarShape(id: String?): Shape = when (id) {
    "circle" -> CircleShape
    "squircle" -> RoundedCornerShape(26)
    else -> PolarShape(9, 0.07f)
}

fun profileColor(hex: String?): Color = runCatching {
    val h = (hex ?: DEFAULT_PROFILE_COLOR).removePrefix("#")
    require(h.length == 6)
    Color(0xFF000000 or h.toLong(16))
}.getOrDefault(Color(0xFFC6B8FF))

/** Тёмный фон в оттенке цвета профиля */
fun profileTint(c: Color, k: Float = 0.16f): Color = Color(
    red = c.red * k + 0.03f * (1 - k), green = c.green * k + 0.03f * (1 - k), blue = c.blue * k + 0.03f * (1 - k), alpha = 1f,
)

/** Текст поверх цвета: тёмный на светлом, белый на тёмном */
fun inkOn(c: Color): Color = if (0.2126f * c.red + 0.7152f * c.green + 0.0722f * c.blue > 0.5f) Color(0xFF120D26) else Color.White

/** Аватар в форме и цвете профиля: фото Telegram или первая буква */
@Composable
fun ShapedAvatar(user: UserCard?, size: Int, shape: String? = user?.shape, color: String? = user?.color, ring: Int = 0, modifier: Modifier = Modifier) {
    val sh = avatarShape(shape)
    val c = profileColor(color)
    Box(modifier.size(size.dp).then(if (ring > 0) Modifier.clip(sh).background(Color.Black).padding(ring.dp) else Modifier).clip(sh).background(c), contentAlignment = Alignment.Center) {
        val pic = user?.picture
        if (pic != null) AsyncImage(model = pic, contentDescription = user.display, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text(((user?.name?.firstOrNull() ?: user?.nick?.firstOrNull()) ?: 'N').uppercase(), color = inkOn(c), fontWeight = FontWeight.Bold, fontSize = ((size - ring * 2) * 0.42f).sp)
    }
}

private val BADGE_TONES = mapOf(
    "yellow" to (Color(0xFF2A2208) to Color(0xFFFFD60A)),
    "blue" to (Color(0xFF1E2A44) to Color(0xFF9FC2FF)),
    "mint" to (Color(0xFF1A2A22) to Color(0xFF7CE0C3)),
    "coral" to (Color(0xFF2A0E0C) to Color(0xFFFF8F84)),
    "pink" to (Color(0xFF2A0E18) to Color(0xFFFF8FB1)),
)

/** Значок-печенька: метка на цвете (accent — цвет профиля) */
@Composable
fun BadgeCookie(b: Badge, size: Int, accent: Color) {
    val (bg, fg) = BADGE_TONES[b.tone] ?: (accent to inkOn(accent))
    val mark = b.mark.ifBlank { b.emoji }
    Box(Modifier.size(size.dp).clip(PolarShape(12, 0.06f)).background(bg), contentAlignment = Alignment.Center) {
        Text(mark, color = fg, fontWeight = FontWeight.ExtraBold, fontSize = (size * if (mark.length >= 3) 0.26f else 0.36f).sp, maxLines = 1)
    }
}

val LINK_NAMES = mapOf(
    "telegram" to "Telegram", "vk" to "ВКонтакте", "youtube" to "YouTube", "soundcloud" to "SoundCloud", "spotify" to "Spotify",
    "yandex" to "Яндекс Музыка", "instagram" to "Instagram", "tiktok" to "TikTok", "x" to "X", "twitch" to "Twitch",
    "github" to "GitHub", "discord" to "Discord",
)

fun linkTitle(l: ProfileLink): String = LINK_NAMES[l.kind] ?: l.url.removePrefix("https://").removePrefix("http://").removePrefix("www.").let { if (it.length > 30) it.take(29) + "…" else it }

fun openLink(ctx: Context, url: String) {
    if (!url.startsWith("https://")) return
    runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LinkChips(links: List<ProfileLink>, accent: Color, modifier: Modifier = Modifier) {
    if (links.isEmpty()) return
    val ctx = LocalContext.current
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        links.forEach { l ->
            Row(
                Modifier.clip(RoundedCornerShape(18.dp)).background(NyaoColors.S2).border(1.dp, accent.copy(alpha = 0.25f), RoundedCornerShape(18.dp))
                    .clickable { openLink(ctx, l.url) }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(NyaoIcons.Link, null, tint = accent, modifier = Modifier.size(16.dp))
                Text(linkTitle(l), style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Шапка профиля: баннер или цвет профиля с печеньками */
@Composable
fun ProfileBanner(banner: String?, accent: Color, height: Int, modifier: Modifier = Modifier, content: @Composable () -> Unit = {}) {
    Box(modifier.fillMaxWidth().height(height.dp).clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(profileTint(accent))) {
        if (banner != null) {
            AsyncImage(model = banner, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.18f)))
        } else {
            val shape = PolarShape(9, 0.07f)
            Canvas(Modifier.fillMaxSize()) {
                val big = size.height * 1.6f
                val outline = shape.createOutline(androidx.compose.ui.geometry.Size(big, big), layoutDirection, this)
                val path = (outline as androidx.compose.ui.graphics.Outline.Generic).path
                translate(size.width - big * 0.7f, -big * 0.35f) { drawPath(path, accent.copy(alpha = 0.45f), style = Stroke(1.5.dp.toPx())) }
                translate(size.width - big * 0.55f, -big * 0.12f) { scale(0.6f, Offset.Zero) { drawPath(path, accent.copy(alpha = 0.3f), style = Stroke(2.dp.toPx())) } }
            }
        }
        content()
    }
}

/** Баннер: обрезка по центру до 3:1, не больше 1500×500, JPEG до ~360 КБ → base64 */
fun prepareBanner(ctx: Context, uri: Uri, maxBytes: Int = 360 * 1024): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0) { "Не получилось открыть картинку" }
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= 1500) sample *= 2
    val src = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        ?: error("Не получилось открыть картинку")
    var sw = src.width
    var sh = sw / 3
    if (sh > src.height) { sh = src.height; sw = sh * 3 }
    val crop = Bitmap.createBitmap(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh)
    val w = minOf(1500, sw)
    val out = Bitmap.createScaledBitmap(crop, w, w / 3, true)
    for (q in listOf(88, 80, 70, 60, 50, 40)) {
        val buf = java.io.ByteArrayOutputStream()
        out.compress(Bitmap.CompressFormat.JPEG, q, buf)
        if (buf.size() <= maxBytes) return android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP)
    }
    error("Картинка не сжимается до нужного размера — попробуй другую")
}

/** Одинаковые реакции подряд (тот же человек, тот же трек) — одной строкой с ×N */
fun groupInbox(items: List<InboxItem>): List<Pair<InboxItem, Int>> {
    val out = ArrayList<Pair<InboxItem, Int>>()
    for (i in items) {
        val last = out.lastOrNull()
        if (last != null && i.kind == "react" && last.first.kind == "react" && last.first.from.id == i.from.id && last.first.emoji == i.emoji && last.first.track?.id == i.track?.id) {
            out[out.size - 1] = last.first.copy(read = last.first.read && i.read) to last.second + 1
        } else out.add(i to 1)
    }
    return out
}

/** Небольшой заголовок секции в профиле */
@Composable
fun ProfileEyebrow(text: String, color: Color = NyaoColors.Muted) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = color, fontWeight = FontWeight.SemiBold)
}

/** Исполнитель кружком с буквой */
@Composable
fun ArtistCircle(name: String, plays: Int, index: Int, size: Int = 76) {
    val tones = listOf(Color(0xFF2A1408) to Color(0xFFFF8A3D), Color(0xFF2A2208) to Color(0xFFFFD60A), Color(0xFF2A0E0C) to Color(0xFFFF6A5C), Color(0xFF141220) to Color(0xFFC6B8FF), Color(0xFF0E1A16) to Color(0xFF7CE0C3))
    val (bg, fg) = tones[index % tones.size]
    Column(Modifier.padding(horizontal = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
            Text(name.trim().take(1).uppercase(), color = fg, fontWeight = FontWeight.ExtraBold, fontSize = (size * 0.34f).sp)
        }
        Text(name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp).size(width = (size + 12).dp, height = 18.dp))
        Text("$plays", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted)
    }
}
