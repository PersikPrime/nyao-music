package org.nyao.legacy;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Локальный прокси на 127.0.0.1. MediaPlayer на 4.x ходит в сеть системным TLS (не договаривается с серверами),
 * поэтому он берёт поток здесь по обычному http, а прокси качает его через Conscrypt. Range передаётся — перемотка работает.
 */
public final class LocalProxy {
    private static LocalProxy inst;
    private final ServerSocket server;
    private final Map<String, String> urls = new ConcurrentHashMap<String, String>();
    private final AtomicInteger seq = new AtomicInteger();
    /** Последний запрос через прокси — для сообщения об ошибке */
    public static volatile String last = "прокси ещё не вызывался";

    public static synchronized LocalProxy get() throws Exception {
        if (inst == null) inst = new LocalProxy();
        return inst;
    }

    private LocalProxy() throws Exception {
        server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (true) {
                    try {
                        final Socket s = server.accept();
                        new Thread(new Runnable() {
                            @Override
                            public void run() {
                                serve(s);
                            }
                        }, "nyao-proxy-conn").start();
                    } catch (Exception e) {
                        if (server.isClosed()) return;
                    }
                }
            }
        }, "nyao-proxy");
        t.setDaemon(true);
        t.start();
    }

    /** Адрес для MediaPlayer */
    public String register(String remote) {
        String key = String.valueOf(seq.incrementAndGet());
        if (urls.size() > 20) urls.clear();
        urls.put(key, remote);
        return "http://127.0.0.1:" + server.getLocalPort() + "/s/" + key;
    }

    /** Перенаправления вручную: HttpURLConnection не переходит между http и https и теряет Range */
    static HttpURLConnection follow(String url, String range) throws Exception {
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = Net.open(url);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept-Encoding", "identity");
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc != null) {
                c.disconnect();
                url = new java.net.URL(new java.net.URL(url), loc).toString();
                continue;
            }
            return c;
        }
        throw new java.io.IOException("слишком много перенаправлений");
    }

    /** Скачать целиком в файл (запасной путь, если плеер не читает поток) */
    public static void download(String url, java.io.File to) throws Exception {
        HttpURLConnection c = follow(url, null);
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new java.io.IOException("сервер ответил " + code);
            InputStream in = c.getInputStream();
            java.io.FileOutputStream out = new java.io.FileOutputStream(to);
            try {
                byte[] buf = new byte[32768];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally {
                out.close();
                in.close();
            }
        } finally {
            c.disconnect();
        }
    }

    private void serve(Socket s) {
        HttpURLConnection c = null;
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), "US-ASCII"));
            String first = in.readLine();
            String range = null;
            String line;
            while ((line = in.readLine()) != null && line.length() > 0) {
                if (line.toLowerCase().startsWith("range:")) range = line.substring(6).trim();
            }
            OutputStream out = s.getOutputStream();
            String path = first != null && first.split(" ").length > 1 ? first.split(" ")[1] : "";
            String remote = path.startsWith("/s/") ? urls.get(path.substring(3)) : null;
            if (remote == null) {
                out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes("US-ASCII"));
                return;
            }
            c = follow(remote, range);
            int code = c.getResponseCode();
            last = "запрос " + (range != null ? range : "без Range") + " → " + code + " " + c.getHeaderField("Content-Type")
                    + " " + c.getHeaderField("Content-Length") + " байт";
            StringBuilder h = new StringBuilder();
            h.append("HTTP/1.1 ").append(code).append(code == 206 ? " Partial Content" : code < 400 ? " OK" : " Error").append("\r\n");
            String type = c.getHeaderField("Content-Type");
            h.append("Content-Type: ").append(type != null ? type : "audio/mpeg").append("\r\n");
            String len = c.getHeaderField("Content-Length");
            if (len != null) h.append("Content-Length: ").append(len).append("\r\n");
            String cr = c.getHeaderField("Content-Range");
            if (cr != null) h.append("Content-Range: ").append(cr).append("\r\n");
            h.append("Accept-Ranges: bytes\r\nConnection: close\r\n\r\n");
            out.write(h.toString().getBytes("US-ASCII"));
            InputStream body = code < 400 ? c.getInputStream() : c.getErrorStream();
            if (body != null) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = body.read(buf)) > 0) out.write(buf, 0, n);
            }
            out.flush();
        } catch (Exception e) {
            // плеер закрыл соединение (перемотка, следующий трек) — это нормально; остальное запоминаем
            if (!(e instanceof java.net.SocketException)) last = "ошибка прокси: " + e;
        } finally {
            if (c != null) c.disconnect();
            try {
                s.close();
            } catch (Exception ignored) {
                // уже закрыт
            }
        }
    }
}
