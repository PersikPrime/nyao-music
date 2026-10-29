package org.nyao.legacy;

import android.util.Base64;

import org.json.JSONObject;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Вход по коду. Устройство создаёт пару ключей RSA-2048, сервер выдаёт код. Основное приложение шифрует
 * токены ключом устройства: payload = base64(RSA-OAEP-SHA1(aesKey)) . base64(iv12) . base64(AES-256-GCM(json)).
 */
public final class Pairing {
    public String id;
    public String secret;
    public String code;
    public long expiresAt;
    private String privateKey; // PKCS8 base64

    public static Pairing start(String device) throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        String pub = Base64.encodeToString(kp.getPublic().getEncoded(), Base64.NO_WRAP);
        JSONObject body = new JSONObject().put("publicKey", pub).put("device", device);
        Net.Resp r = Net.call("POST", Net.API + "/legacy/pair", null, "application/json", body.toString().getBytes("UTF-8"));
        if (!r.ok()) throw new Exception(Net.errorText(r));
        JSONObject o = new JSONObject(r.text);
        Pairing p = new Pairing();
        p.id = o.getString("id");
        p.secret = o.getString("secret");
        p.code = o.getString("code");
        p.expiresAt = System.currentTimeMillis() + o.optLong("expiresIn", 600) * 1000;
        p.privateKey = Base64.encodeToString(kp.getPrivate().getEncoded(), Base64.NO_WRAP);
        return p;
    }

    /** null — ещё ждём; иначе ответ сервера с расшифрованным пакетом в поле "data" */
    public JSONObject poll() throws Exception {
        Net.Resp r = Net.call("GET", Net.API + "/legacy/pair/" + id + "?secret=" + secret, null, null, null);
        if (r.code == 410) throw new Net.HttpException(410, "Код устарел");
        if (!r.ok()) throw new Exception(Net.errorText(r));
        JSONObject o = new JSONObject(r.text);
        if (!"done".equals(o.optString("status"))) return null;
        o.put("data", new JSONObject(decrypt(o.getString("payload"))));
        return o;
    }

    String decrypt(String payload) throws Exception {
        String[] parts = payload.split("\\.");
        if (parts.length != 3) throw new Exception("Пакет не того формата");
        PrivateKey pk = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(privateKey, Base64.DEFAULT)));
        Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding");
        rsa.init(Cipher.DECRYPT_MODE, pk);
        byte[] aes = rsa.doFinal(Base64.decode(parts[0], Base64.DEFAULT));
        // AES-GCM на 4.x есть только в Conscrypt; GCMParameterSpec появился в API 19, IvParameterSpec Conscrypt понимает
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding", org.conscrypt.Conscrypt.newProvider());
        gcm.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aes, "AES"), new IvParameterSpec(Base64.decode(parts[1], Base64.DEFAULT)));
        return new String(gcm.doFinal(Base64.decode(parts[2], Base64.DEFAULT)), "UTF-8");
    }
}
