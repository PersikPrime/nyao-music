package org.nyao.legacy;

import android.content.Context;
import android.util.Base64;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyStore;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Защищённое соединение для старых Android.
 *
 * В Android 4.x нет современных корневых сертификатов (Let's Encrypt ISRG Root X1/X2 и новые YE/YR,
 * Google Trust Services), а TLS 1.2 для исходящих соединений выключен по умолчанию. Поэтому:
 *  - корни лежат в самом приложении (assets/roots/*.pem), и сервер проверяется только ими;
 *  - TLS 1.2 включается принудительно, старые протоколы (SSLv3, TLS 1.0/1.1) не используются;
 *  - из шифров берутся только стойкие (ECDHE, AES-GCM/CBC, ChaCha20).
 */
public final class NyaoTls {
    private NyaoTls() {
    }

    /** Проверка сертификатов только корнями из приложения */
    public static X509TrustManager nyaoTrust(Context ctx) throws Exception {
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        String[] names = ctx.getAssets().list("roots");
        int n = 0;
        if (names != null) {
            for (String name : names) {
                if (!name.endsWith(".pem")) continue;
                byte[] der = pemToDer(new String(readAll(ctx.getAssets().open("roots/" + name)), "US-ASCII"));
                X509Certificate c = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(der));
                ks.setCertificateEntry(name, c);
                n++;
            }
        }
        if (n == 0) throw new IllegalStateException("в приложении нет корневых сертификатов");
        return firstX509(ks);
    }

    /** Системное хранилище — для сравнения */
    public static X509TrustManager systemTrust() throws Exception {
        return firstX509(null);
    }

    /** Список корней из приложения: имя файла и CN */
    public static List<String> rootNames(Context ctx) {
        List<String> out = new ArrayList<String>();
        try {
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            String[] names = ctx.getAssets().list("roots");
            if (names == null) return out;
            for (String name : names) {
                if (!name.endsWith(".pem")) continue;
                byte[] der = pemToDer(new String(readAll(ctx.getAssets().open("roots/" + name)), "US-ASCII"));
                X509Certificate c = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(der));
                out.add(cn(c.getSubjectX500Principal().getName()));
            }
        } catch (Exception e) {
            out.add("ошибка чтения: " + e);
        }
        return out;
    }

    private static X509TrustManager firstX509(KeyStore ks) throws Exception {
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks);
        for (TrustManager tm : tmf.getTrustManagers()) {
            if (tm instanceof X509TrustManager) return (X509TrustManager) tm;
        }
        throw new IllegalStateException("нет X509TrustManager");
    }

    static byte[] pemToDer(String pem) {
        StringBuilder b64 = new StringBuilder();
        for (String line : pem.split("\n")) {
            String l = line.trim();
            if (l.length() == 0 || l.startsWith("-----")) continue;
            b64.append(l);
        }
        return Base64.decode(b64.toString(), Base64.DEFAULT);
    }

    static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    /** CN из имени вида "CN=ISRG Root X1,O=Internet Security Research Group,C=US" */
    public static String cn(String dn) {
        for (String part : dn.split(",")) {
            String p = part.trim();
            if (p.startsWith("CN=")) return p.substring(3);
        }
        return dn;
    }

    /**
     * SNI — имя сервера в рукопожатии. Без него Cloudflare и многие серверы не знают, какой сертификат отдать.
     * На 4.x сокет сам его не ставит: включаем через setHostname (есть у OpenSSLSocketImpl с Android 4.0).
     */
    public static String setSni(SSLSocket s, String host) {
        try {
            if (org.conscrypt.Conscrypt.isConscrypt(s)) {
                org.conscrypt.Conscrypt.setHostname(s, host);
                return "включён";
            }
        } catch (Throwable ignored) {
            // нет Conscrypt — дальше системный способ
        }
        try {
            s.getClass().getMethod("setHostname", String.class).invoke(s, host);
            try {
                s.getClass().getMethod("setUseSessionTickets", boolean.class).invoke(s, true);
            } catch (Throwable ignored) {
                // не обязательно
            }
            return "включён";
        } catch (Throwable t) {
            return "не удалось (" + t.getClass().getSimpleName() + ")";
        }
    }

    /** Версия встроенного Conscrypt или текст ошибки, если он не загрузился на этом устройстве */
    public static String conscryptInfo() {
        try {
            org.conscrypt.Conscrypt.Version v = org.conscrypt.Conscrypt.version();
            return "Conscrypt " + v.major() + "." + v.minor() + "." + v.patch()
                    + (org.conscrypt.Conscrypt.isAvailable() ? "" : " (недоступен)");
        } catch (Throwable t) {
            return "Conscrypt не загрузился: " + t;
        }
    }

    /** Сначала корни Nyao, потом системные: для Яндекса, YouTube и прочих сайтов */
    public static final class Composite implements X509TrustManager {
        private final X509TrustManager a;
        private final X509TrustManager b;

        public Composite(X509TrustManager a, X509TrustManager b) {
            this.a = a;
            this.b = b;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            b.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            try {
                a.checkServerTrusted(chain, authType);
            } catch (CertificateException e) {
                b.checkServerTrusted(chain, authType);
            }
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            X509Certificate[] x = a.getAcceptedIssuers();
            X509Certificate[] y = b.getAcceptedIssuers();
            X509Certificate[] out = new X509Certificate[x.length + y.length];
            System.arraycopy(x, 0, out, 0, x.length);
            System.arraycopy(y, 0, out, x.length, y.length);
            return out;
        }
    }

    /** Обёртка, которая запоминает цепочку от сервера — чтобы показать её даже при ошибке проверки */
    public static final class Recording implements X509TrustManager {
        private final X509TrustManager inner;
        public volatile X509Certificate[] lastChain;

        public Recording(X509TrustManager inner) {
            this.inner = inner;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            inner.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            lastChain = chain;
            inner.checkServerTrusted(chain, authType);
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return inner.getAcceptedIssuers();
        }
    }

    /** Фабрика сокетов: только TLS 1.2+ и стойкие шифры */
    public static final class Tls12Factory extends SSLSocketFactory {
        private final SSLSocketFactory d;
        private final boolean conscrypt;
        public volatile SSLSocket last;

        public Tls12Factory(X509TrustManager tm) throws Exception {
            this(tm, false);
        }

        /**
         * conscrypt = true — свой TLS-движок (BoringSSL внутри APK) вместо системного OpenSSL 4.x:
         * в системном на 4.4 нет AES-GCM и ChaCha20, а серверы (Cloudflare, Caddy) старые CBC-шифры не принимают.
         */
        public Tls12Factory(X509TrustManager tm, boolean conscrypt) throws Exception {
            this.conscrypt = conscrypt;
            SSLContext ctx;
            if (conscrypt) {
                ctx = SSLContext.getInstance("TLS", org.conscrypt.Conscrypt.newProvider());
            } else {
                try {
                    ctx = SSLContext.getInstance("TLSv1.2");
                } catch (NoSuchAlgorithmException e) {
                    ctx = SSLContext.getInstance("TLS");
                }
            }
            ctx.init(null, new TrustManager[]{tm}, null);
            d = ctx.getSocketFactory();
        }

        private Socket patch(Socket s) {
            if (s instanceof SSLSocket) {
                SSLSocket ss = (SSLSocket) s;
                ss.setEnabledProtocols(protocols(ss.getSupportedProtocols()));
                // у Conscrypt набор шифров по умолчанию и так современный
                if (!conscrypt) ss.setEnabledCipherSuites(suites(ss.getEnabledCipherSuites(), ss.getSupportedCipherSuites()));
                last = ss;
            }
            return s;
        }

        static String[] protocols(String[] supported) {
            List<String> out = new ArrayList<String>();
            for (String p : supported) {
                if ("TLSv1.3".equals(p) || "TLSv1.2".equals(p)) out.add(p);
            }
            // TLS 1.2 нет совсем (Android 4.0) — оставляем как есть, соединение честно не установится
            return out.isEmpty() ? supported : out.toArray(new String[0]);
        }

        static boolean weak(String s) {
            return s.contains("_anon_") || s.contains("NULL") || s.contains("EXPORT") || s.contains("RC4")
                    || s.contains("_DES_") || s.contains("3DES") || s.contains("MD5") || s.contains("SCSV");
        }

        static String[] suites(String[] enabled, String[] supported) {
            Set<String> out = new LinkedHashSet<String>();
            // сначала AEAD-шифры (на 4.4 они есть, но могут быть выключены по умолчанию)
            for (String s : supported) {
                if (weak(s)) continue;
                if (s.startsWith("TLS_AES_") || s.startsWith("TLS_CHACHA20_")) out.add(s);
                else if (s.contains("ECDHE") && (s.contains("GCM") || s.contains("CHACHA20"))) out.add(s);
            }
            for (String s : supported) {
                if (!weak(s) && s.contains("ECDHE") && s.contains("CBC")) out.add(s);
            }
            for (String s : enabled) {
                if (!weak(s)) out.add(s);
            }
            return out.toArray(new String[0]);
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return d.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return d.getSupportedCipherSuites();
        }

        @Override
        public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            Socket out = patch(d.createSocket(s, host, port, autoClose));
            if (out instanceof SSLSocket) setSni((SSLSocket) out, host);
            return out;
        }

        @Override
        public Socket createSocket() throws IOException {
            return patch(d.createSocket());
        }

        @Override
        public Socket createSocket(String host, int port) throws IOException {
            return patch(d.createSocket(host, port));
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
            return patch(d.createSocket(host, port, localHost, localPort));
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws IOException {
            return patch(d.createSocket(host, port));
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
            return patch(d.createSocket(address, port, localAddress, localPort));
        }
    }
}
