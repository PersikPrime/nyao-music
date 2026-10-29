package org.nyao.legacy;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.View;

/** Три волны Nyao (жёлтая, коралловая, лавандовая) — без векторных картинок, которых нет на 4.x */
public class WavesView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private static final int[] COLORS = {0xFFFFD60A, 0xFFF0574A, 0xFFCFC4FF};
    private static final float[] OFFSETS = {10.6f, 13.4f, 12f};

    public WavesView(Context c, AttributeSet a) {
        super(c, a);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float k = Math.min(getWidth(), getHeight()) / 24f;
        float dx = (getWidth() - 24 * k) / 2;
        float dy = (getHeight() - 24 * k) / 2;
        paint.setStrokeWidth(2.4f * k);
        for (int i = 0; i < 3; i++) {
            float y = OFFSETS[i];
            // как в логотипе: M3 y c3-5 6-5 9 0 s6 5 9 0
            path.reset();
            path.moveTo(dx + 3 * k, dy + y * k);
            path.cubicTo(dx + 6 * k, dy + (y - 5) * k, dx + 9 * k, dy + (y - 5) * k, dx + 12 * k, dy + y * k);
            path.cubicTo(dx + 15 * k, dy + (y + 5) * k, dx + 18 * k, dy + (y + 5) * k, dx + 21 * k, dy + y * k);
            paint.setColor(COLORS[i]);
            canvas.drawPath(path, paint);
        }
    }
}
