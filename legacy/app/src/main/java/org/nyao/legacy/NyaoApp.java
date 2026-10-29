package org.nyao.legacy;

import android.app.Application;

public class NyaoApp extends Application {
    public static Store store;
    public static Yandex ya;
    public static String netError;

    @Override
    public void onCreate() {
        super.onCreate();
        store = new Store(this);
        try {
            Net.init(this);
        } catch (Exception e) {
            netError = e.toString();
        }
        refreshServices();
    }

    public static void refreshServices() {
        String t = store.get("yandexToken");
        ya = t != null ? new Yandex(t) : null;
    }
}
