package org.nyao.legacy;

/** Трек Яндекс Музыки (YouTube Music — в следующей версии) */
public final class Track {
    public String id;      // id Яндекса
    public String albumId;
    public String title;
    public String artist;
    public String cover;   // ссылка на обложку 200×200 или null
    public int duration;   // секунды
    public boolean available = true;

    public String key() {
        return albumId != null ? id + ":" + albumId : id;
    }

    public String coverUrl(int size) {
        return cover == null ? null : "https://" + cover.replace("%%", size + "x" + size);
    }
}
