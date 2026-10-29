package org.nyao.legacy;

import android.content.Context;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.X509TrustManager;

/** Все запросы приложения: через Conscrypt (TLS 1.2/1.3) и корни Nyao + системные */
public final class Net {
    private Net() {
    }

    public static final String API = "https://api.music.withnyao.app";
    private static NyaoTls.Tls12Factory factory;

    public static class Resp {
        public final int code;
        public final String text;

        Resp(int code, String text) {
            this.code = code;
            this.text = text;
        }

        public boolean ok() {
            return code >= 200 && code < 300;
        }
    }

    public static class HttpException extends IOException {
        public final int code;

        public HttpException(int code, String msg) {
            super(msg);
            this.code = code;
        }
    }

    public static synchronized void init(Context ctx) throws Exception {
        if (factory != null) return;
        X509TrustManager t = new NyaoTls.Composite(NyaoTls.nyaoTrust(ctx), NyaoTls.systemTrust());
        factory = new NyaoTls.Tls12Factory(t, true);
    }

    public static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (c instanceof HttpsURLConnection) ((HttpsURLConnection) c).setSSLSocketFactory(factory);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "NyaoLegacy/0.1 (Android " + android.os.Build.VERSION.RELEASE + ")");
        return c;
    }

    public static Resp call(String method, String url, Map<String, String> headers, String contentType, byte[] body) throws IOException {
        HttpURLConnection c = open(url);
        try {
            c.setRequestMethod(method);
            if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", contentType);
                c.setFixedLengthStreamingMode(body.length);
                OutputStream out = c.getOutputStream();
                out.write(body);
                out.close();
            }
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String text = in == null ? "" : new String(NyaoTls.readAll(in), "UTF-8");
            return new Resp(code, text);
        } finally {
            c.disconnect();
        }
    }

    public static byte[] bytes(String url) throws IOException {
        HttpURLConnection c = open(url);
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new HttpException(code, "HTTP " + code);
            return NyaoTls.readAll(c.getInputStream());
        } finally {
            c.disconnect();
        }
    }

    /** Ошибка сервера Nyao — текст из {"error": "..."} */
    public static String errorText(Resp r) {
        try {
            return new org.json.JSONObject(r.text).optString("error", "Ошибка " + r.code);
        } catch (Exception e) {
            return "Ошибка " + r.code;
        }
    }
}
