package org.nyao.legacy;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Фоновые задачи и возврат в главный поток */
public final class Bg {
    private Bg() {
    }

    private static final ExecutorService POOL = Executors.newFixedThreadPool(3);
    public static final Handler UI = new Handler(Looper.getMainLooper());

    public interface Job<T> {
        T run() throws Exception;
    }

    public interface Done<T> {
        void ok(T value);

        void fail(Exception e);
    }

    public static <T> void run(final Job<T> job, final Done<T> done) {
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final T v = job.run();
                    UI.post(new Runnable() {
                        @Override
                        public void run() {
                            if (done != null) done.ok(v);
                        }
                    });
                } catch (final Exception e) {
                    UI.post(new Runnable() {
                        @Override
                        public void run() {
                            if (done != null) done.fail(e);
                        }
                    });
                }
            }
        });
    }

    public static void ui(Runnable r) {
        UI.post(r);
    }
}
