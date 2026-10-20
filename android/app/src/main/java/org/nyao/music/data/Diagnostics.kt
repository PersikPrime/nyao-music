package org.nyao.music.data

object Diagnostics {
    fun safe(value: String): String = value
        .replace(Regex("""https?://[^\s"'<>]+""", RegexOption.IGNORE_CASE), "[адрес скрыт]")
        .replace(Regex("""\b(Bearer|OAuth)\s+[^\s"',;]+""", RegexOption.IGNORE_CASE), "$1 [скрыто]")
        .replace(Regex("""((?:cookie|authorization|access_token|refresh_token|oauth_token|web_token|client_secret|datadome)\s*["']?\s*[:=]\s*)[^\r\n]+""", RegexOption.IGNORE_CASE), "$1[скрыто]")
        .take(4000)
}
