package org.nyao.legacy;

import android.content.Context;
import android.content.SharedPreferences;

/** Настройки и токены. Токены сервисов хранятся только на устройстве */
public final class Store {
    private final SharedPreferences p;

    public Store(Context ctx) {
        p = ctx.getSharedPreferences("nyao", Context.MODE_PRIVATE);
    }

    public String get(String k) {
        return p.getString(k, null);
    }

    public void put(String k, String v) {
        p.edit().putString(k, v).commit();
    }

    public boolean paired() {
        return get("yandexToken") != null || get("ytCookie") != null;
    }

    public void clear() {
        p.edit().clear().commit();
    }
}
