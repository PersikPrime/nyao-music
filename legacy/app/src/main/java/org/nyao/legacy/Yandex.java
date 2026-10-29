package org.nyao.legacy;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Яндекс Музыка: те же запросы, что в основном приложении (YandexApi.kt) */
public final class Yandex {
    private static final String API = "https://api.music.yandex.net";
    private static final String SIGN_SALT = "XGRlBW9FXlekgbPrRHuSiA";

    private final String token;
    private String uid;
    public final Set<String> liked = new HashSet<String>();

    public Yandex(String token) {
        this.token = token;
    }

    private Map<String, String> headers() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("X-Yandex-Music-Client", "YandexMusicAndroid/24023621");
        h.put("Accept-Language", "ru");
        h.put("Authorization", "OAuth " + token);
        return h;
    }

    private String raw(String method, String pathOrUrl, String form) throws Exception {
        String url = pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl;
        Net.Resp r = Net.call(method, url, headers(), "application/x-www-form-urlencoded",
                form != null ? form.getBytes("UTF-8") : ("POST".equals(method) ? new byte[0] : null));
        if (!r.ok()) throw new Net.HttpException(r.code, "Яндекс: ошибка " + r.code);
        return r.text;
    }

    private Object result(String method, String path, String form) throws Exception {
        String t = raw(method, path, form).trim();
        if (t.startsWith("[")) return new JSONArray(t);
        JSONObject o = new JSONObject(t);
        return o.has("result") ? o.get("result") : o;
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }

    public static Track map(JSONObject t) {
        if (t == null || !t.has("id")) return null;
        Track x = new Track();
        x.id = t.optString("id");
        JSONArray albums = t.optJSONArray("albums");
        JSONObject album = albums != null && albums.length() > 0 ? albums.optJSONObject(0) : null;
        if (album != null && album.has("id")) x.albumId = album.optString("id");
        String version = t.optString("version", null);
        x.title = t.optString("title") + (version != null && version.length() > 0 ? " (" + version + ")" : "");
        StringBuilder a = new StringBuilder();
        JSONArray artists = t.optJSONArray("artists");
        if (artists != null) for (int i = 0; i < artists.length(); i++) {
            String n = artists.optJSONObject(i).optString("name");
            if (n.length() == 0) continue;
            if (a.length() > 0) a.append(", ");
            a.append(n);
        }
        x.artist = a.length() > 0 ? a.toString() : "Неизвестный исполнитель";
        String cover = t.optString("coverUri", null);
        if ((cover == null || cover.length() == 0) && album != null) cover = album.optString("coverUri", null);
        x.cover = cover != null && cover.length() > 0 ? cover : null;
        x.duration = (int) (t.optLong("durationMs", 0) / 1000);
        x.available = t.optBoolean("available", true);
        return x;
    }

    public String uid() throws Exception {
        if (uid != null) return uid;
        JSONObject st = (JSONObject) result("GET", "/account/status", null);
        JSONObject acc = st.optJSONObject("account");
        if (acc == null || !acc.has("uid")) throw new Exception("Яндекс не вернул id пользователя — войди заново");
        uid = String.valueOf(acc.opt("uid"));
        return uid;
    }

    /** «Моя волна»: следующая порция. lastId — последний трек в очереди (чтобы не повторялись) */
    public List<Track> wave(String lastId) throws Exception {
        String q = "/rotor/station/user:onyourwave/tracks?settings2=true" + (lastId != null ? "&queue=" + enc(lastId) : "");
        JSONObject o = (JSONObject) result("GET", q, null);
        List<Track> out = new ArrayList<Track>();
        JSONArray seq = o.optJSONArray("sequence");
        if (seq != null) for (int i = 0; i < seq.length(); i++) {
            Track t = map(seq.optJSONObject(i).optJSONObject("track"));
            if (t != null && t.available) out.add(t);
        }
        return out;
    }

    public List<Track> likes() throws Exception {
        JSONObject o = (JSONObject) result("GET", "/users/" + uid() + "/likes/tracks", null);
        JSONObject lib = o.optJSONObject("library");
        JSONArray arr = lib != null ? lib.optJSONArray("tracks") : null;
        List<String> ids = new ArrayList<String>();
        liked.clear();
        if (arr != null) for (int i = 0; i < arr.length(); i++) {
            JSONObject it = arr.optJSONObject(i);
            String id = it.optString("id");
            liked.add(id);
            String album = it.optString("albumId", null);
            ids.add(album != null && album.length() > 0 ? id + ":" + album : id);
        }
        List<Track> out = new ArrayList<Track>();
        for (int i = 0; i < ids.size(); i += 200) {
            StringBuilder b = new StringBuilder();
            for (int j = i; j < Math.min(ids.size(), i + 200); j++) {
                if (b.length() > 0) b.append(',');
                b.append(ids.get(j));
            }
            JSONArray res = (JSONArray) result("POST", "/tracks", "track-ids=" + enc(b.toString()) + "&with-positions=false");
            for (int k = 0; k < res.length(); k++) {
                Track t = map(res.optJSONObject(k));
                if (t != null) out.add(t);
            }
        }
        return out;
    }

    public List<Track> search(String text) throws Exception {
        JSONObject o = (JSONObject) result("GET", "/search?type=track&page=0&nocorrect=false&text=" + enc(text), null);
        List<Track> out = new ArrayList<Track>();
        JSONObject tracks = o.optJSONObject("tracks");
        JSONArray res = tracks != null ? tracks.optJSONArray("results") : null;
        if (res != null) for (int i = 0; i < res.length(); i++) {
            Track t = map(res.optJSONObject(i));
            if (t != null) out.add(t);
        }
        return out;
    }

    public void like(Track t, boolean on) throws Exception {
        raw("POST", "/users/" + uid() + "/likes/tracks/" + (on ? "add-multiple" : "remove"), "track-ids=" + enc(t.key()));
        if (on) liked.add(t.id);
        else liked.remove(t.id);
    }

    /** Прямая ссылка на MP3 (живёт около часа) */
    public String streamUrl(String id) throws Exception {
        JSONArray infos = (JSONArray) result("GET", "/tracks/" + id + "/download-info", null);
        JSONObject best = null;
        for (int i = 0; i < infos.length(); i++) {
            JSONObject x = infos.optJSONObject(i);
            if (!"mp3".equals(x.optString("codec"))) continue;
            if (best == null || x.optInt("bitrateInKbps") > best.optInt("bitrateInKbps")) best = x;
        }
        if (best == null) throw new Exception("Яндекс не отдал трек (нет подписки или трек недоступен)");
        String xml = raw("GET", best.optString("downloadInfoUrl"), null);
        String host = tag(xml, "host");
        String path = tag(xml, "path");
        String ts = tag(xml, "ts");
        String s = tag(xml, "s");
        if (host == null || path == null || ts == null || s == null) throw new Exception("Не удалось разобрать ответ Яндекса");
        return "https://" + host + "/get-mp3/" + md5(SIGN_SALT + path.substring(1) + s) + "/" + ts + path;
    }

    /** Текст в формате LRC или null */
    public String lyrics(String id) {
        try {
            String ts = String.valueOf(System.currentTimeMillis() / 1000);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("p93jhgh689SBReK6ghtw62".getBytes("UTF-8"), "HmacSHA256"));
            String sign = Base64.encodeToString(mac.doFinal((id + ts).getBytes("UTF-8")), Base64.NO_WRAP);
            JSONObject r = (JSONObject) result("GET", "/tracks/" + id + "/lyrics?format=LRC&timeStamp=" + ts + "&sign=" + enc(sign), null);
            String url = r.optString("downloadUrl", null);
            if (url == null) return null;
            return new String(Net.bytes(url), "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    private static String tag(String xml, String name) {
        Matcher m = Pattern.compile("<" + name + ">([^<]*)</" + name + ">").matcher(xml);
        return m.find() ? m.group(1) : null;
    }

    private static String md5(String s) throws Exception {
        byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes("UTF-8"));
        StringBuilder b = new StringBuilder();
        for (byte x : d) b.append(String.format("%02x", x & 0xff));
        return b.toString();
    }
}
