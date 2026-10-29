package org.nyao.legacy;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.InputStream;
import java.net.URL;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.X509TrustManager;

/**
 * Пробная сборка: проверяет, что старый Android договаривается с сервером Nyao.
 * Два режима — корни из приложения и системное хранилище (для сравнения), два адреса сервера.
 */
public class ProbeActivity extends Activity {
    static final String[] HOSTS = {"api.nmusic.bixtl.cc", "api.music.withnyao.app"};

    private TextView log;
    private ScrollView scroll;
    private Button btnNyao;
    private Button btnSystem;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.probe);
        log = (TextView) findViewById(R.id.log);
        scroll = (ScrollView) findViewById(R.id.scroll);
        btnNyao = (Button) findViewById(R.id.btnNyao);
        btnSystem = (Button) findViewById(R.id.btnSystem);
        ((TextView) findViewById(R.id.info)).setText(
                "Nyao Legacy 0.1 - пробная сборка 2\n"
                        + "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ") - "
                        + Build.MANUFACTURER + " " + Build.MODEL);
        btnNyao.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                run(true);
            }
        });
        btnSystem.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                run(false);
            }
        });
    }

    private void run(final boolean nyao) {
        btnNyao.setEnabled(false);
        btnSystem.setEnabled(false);
        log.setText("");
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (nyao) {
                        line("Режим: корни из приложения " + NyaoTls.rootNames(ProbeActivity.this));
                    } else {
                        line("Режим: системные сертификаты Android");
                    }
                    try {
                        SSLSocket s = (SSLSocket) SSLContext.getDefault().getSocketFactory().createSocket();
                        line("Протоколы: есть " + Arrays.toString(s.getSupportedProtocols())
                                + ", включены по умолчанию " + Arrays.toString(s.getEnabledProtocols()));
                        s.close();
                    } catch (Throwable t) {
                        line("Протоколы: не удалось узнать (" + describe(t) + ")");
                    }
                    X509TrustManager base = nyao ? NyaoTls.nyaoTrust(ProbeActivity.this) : NyaoTls.systemTrust();
                    for (String host : HOSTS) probe(host, base);
                    line("\nГотово. Текст можно выделить и скопировать.");
                } catch (Throwable t) {
                    line("Ошибка подготовки: " + describe(t));
                } finally {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            btnNyao.setEnabled(true);
                            btnSystem.setEnabled(true);
                        }
                    });
                }
            }
        }).start();
    }

    /**
     * Прямое рукопожатие, без встроенного HTTP-клиента: он на 4.4 после неудачи молча повторяет через SSLv3
     * и прячет настоящую ошибку. Пробуем три набора шифров, чтобы понять, что именно не сходится.
     */
    private void raw(String host, X509TrustManager base) {
        String[][] variants = {{"все стойкие", ""}, {"только GCM", "GCM"}, {"только CBC", "CBC"}};
        for (String[] v : variants) {
            NyaoTls.Recording rec = new NyaoTls.Recording(base);
            SSLSocket s = null;
            try {
                NyaoTls.Tls12Factory f = new NyaoTls.Tls12Factory(rec);
                java.net.Socket tcp = new java.net.Socket();
                tcp.connect(new java.net.InetSocketAddress(host, 443), 15000);
                tcp.setSoTimeout(15000);
                s = (SSLSocket) f.createSocket(tcp, host, 443, true);
                if (v[1].length() > 0) {
                    java.util.List<String> only = new java.util.ArrayList<String>();
                    for (String c : s.getEnabledCipherSuites()) if (c.contains(v[1])) only.add(c);
                    s.setEnabledCipherSuites(only.toArray(new String[0]));
                }
                String sni = NyaoTls.setSni(s, host);
                s.startHandshake();
                boolean nameOk = javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s.getSession());
                line("  рукопожатие (" + v[0] + "): [OK] " + s.getSession().getProtocol() + " - " + s.getSession().getCipherSuite()
                        + (nameOk ? "" : " [ИМЯ НЕ СОВПАЛО]") + " - SNI " + sni);
                if (v[1].length() == 0) {
                    chain(rec.lastChain);
                    httpOver(s, host);
                }
            } catch (Throwable t) {
                line("  рукопожатие (" + v[0] + "): [ОШИБКА] " + describe(t));
                if (v[1].length() == 0) chain(rec.lastChain);
            } finally {
                try {
                    if (s != null) s.close();
                } catch (Throwable ignored) {
                    // уже закрыт
                }
            }
        }
    }

    /** Простой GET поверх уже установленного соединения */
    private void httpOver(SSLSocket s, String host) throws Exception {
        java.io.OutputStream out = s.getOutputStream();
        out.write(("GET /updates/latest HTTP/1.1\r\nHost: " + host + "\r\nUser-Agent: NyaoLegacy/0.1 (Android "
                + Build.VERSION.RELEASE + ")\r\nAccept: application/json\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
        out.flush();
        String resp = new String(NyaoTls.readAll(s.getInputStream()), "UTF-8");
        int eol = resp.indexOf("\r\n");
        line("  " + (eol > 0 ? resp.substring(0, eol) : "ответ пустой"));
        Matcher m = Pattern.compile("\"tag_name\"\\s*:\\s*\"([^\"]+)\"").matcher(resp);
        if (m.find()) line("  последний релиз: " + m.group(1));
    }

    private void probe(String host, X509TrustManager base) {
        line("\n>> " + host);
        raw(host, base);
        line("  -- через встроенный HTTP-клиент:");
        NyaoTls.Recording rec = new NyaoTls.Recording(base);
        HttpsURLConnection c = null;
        long t0 = SystemClock.elapsedRealtime();
        try {
            NyaoTls.Tls12Factory f = new NyaoTls.Tls12Factory(rec);
            c = (HttpsURLConnection) new URL("https://" + host + "/updates/latest").openConnection();
            c.setSSLSocketFactory(f);
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "NyaoLegacy/0.1 (Android " + Build.VERSION.RELEASE + ")");
            int code = c.getResponseCode();
            long ms = SystemClock.elapsedRealtime() - t0;
            String proto = "?";
            SSLSocket s = f.last;
            if (s != null) {
                try {
                    proto = s.getSession().getProtocol();
                } catch (Throwable ignored) {
                    // сокет уже закрыт
                }
            }
            line("[OK] " + proto + " - " + c.getCipherSuite());
            line("     HTTP " + code + " за " + ms + " мс");
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String body = in == null ? "" : new String(NyaoTls.readAll(in), "UTF-8");
            Matcher m = Pattern.compile("\"tag_name\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
            if (m.find()) line("     последний релиз: " + m.group(1));
            else line("     ответ: " + (body.length() > 160 ? body.substring(0, 160) + "..." : body));
        } catch (Throwable t) {
            line("[ОШИБКА] " + describe(t));
        } finally {
            chain(rec.lastChain);
            if (c != null) c.disconnect();
        }
    }

    private void chain(X509Certificate[] chain) {
        if (chain == null) {
            line("     цепочка: сервер её не прислал (до проверки не дошло)");
            return;
        }
        SimpleDateFormat df = new SimpleDateFormat("dd.MM.yyyy", Locale.US);
        line("     цепочка от сервера:");
        for (int i = 0; i < chain.length; i++) {
            X509Certificate x = chain[i];
            line("     " + (i + 1) + ". " + NyaoTls.cn(x.getSubjectX500Principal().getName())
                    + "  <- " + NyaoTls.cn(x.getIssuerX500Principal().getName())
                    + "  (до " + df.format(x.getNotAfter()) + ")");
        }
    }

    private static String describe(Throwable t) {
        StringBuilder b = new StringBuilder();
        int depth = 0;
        while (t != null && depth < 4) {
            if (depth > 0) b.append("\n       причина: ");
            b.append(t.getClass().getSimpleName());
            if (t.getMessage() != null) b.append(": ").append(t.getMessage());
            t = t.getCause();
            depth++;
        }
        return b.toString();
    }

    private void line(final String s) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                log.append(s + "\n");
                scroll.post(new Runnable() {
                    @Override
                    public void run() {
                        scroll.fullScroll(View.FOCUS_DOWN);
                    }
                });
            }
        });
    }
}
