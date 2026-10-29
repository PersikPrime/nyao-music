package org.nyao.legacy;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;
import android.widget.ImageView;

/** Обложки: кэш в памяти, загрузка в фоне. На ImageView ставится тег — чтобы в списке не путались строки */
public final class Images {
    private Images() {
    }

    private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(8 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
            return value.getRowBytes() * value.getHeight();
        }
    };

    public static void load(final ImageView v, final String url, final int placeholderColor) {
        v.setTag(url);
        if (url == null) {
            v.setImageDrawable(null);
            v.setBackgroundColor(placeholderColor);
            return;
        }
        Bitmap b = CACHE.get(url);
        if (b != null) {
            v.setImageBitmap(b);
            return;
        }
        v.setImageDrawable(null);
        v.setBackgroundColor(placeholderColor);
        Bg.run(new Bg.Job<Bitmap>() {
            @Override
            public Bitmap run() throws Exception {
                byte[] d = Net.bytes(url);
                return BitmapFactory.decodeByteArray(d, 0, d.length);
            }
        }, new Bg.Done<Bitmap>() {
            @Override
            public void ok(Bitmap value) {
                if (value == null) return;
                CACHE.put(url, value);
                if (url.equals(v.getTag())) v.setImageBitmap(value);
            }

            @Override
            public void fail(Exception e) {
                // остаётся цветная заглушка
            }
        });
    }
}
