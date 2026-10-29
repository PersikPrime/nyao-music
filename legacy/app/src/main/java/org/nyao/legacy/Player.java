package org.nyao.legacy;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.PowerManager;

import java.util.ArrayList;
import java.util.List;

/** Очередь и воспроизведение. Один на приложение; экраны подписываются на изменения */
public final class Player {
    private static Player inst;

    public static synchronized Player get(Context ctx) {
        if (inst == null) inst = new Player(ctx.getApplicationContext());
        return inst;
    }

    private final Context ctx;
    private final List<Runnable> listeners = new ArrayList<Runnable>();
    private MediaPlayer mp;
    private boolean prepared;
    private int token; // защита от ответов для уже переключённого трека
    private boolean loadingMore;

    public final List<Track> queue = new ArrayList<Track>();
    public int index = -1;
    public boolean wave;
    public String source = "";
    public String error;
    public Lrc lyrics;
    private Yandex ya;

    private Player(Context ctx) {
        this.ctx = ctx;
    }

    public void setYandex(Yandex y) {
        ya = y;
    }

    public Track current() {
        return index >= 0 && index < queue.size() ? queue.get(index) : null;
    }

    public void addListener(Runnable r) {
        listeners.add(r);
    }

    public void removeListener(Runnable r) {
        listeners.remove(r);
    }

    private void changed() {
        for (Runnable r : new ArrayList<Runnable>(listeners)) r.run();
        PlayerService.update(ctx);
    }

    public boolean playing() {
        return mp != null && prepared && mp.isPlaying();
    }

    public boolean loading() {
        return current() != null && !prepared && error == null;
    }

    public int position() {
        return mp != null && prepared ? mp.getCurrentPosition() : 0;
    }

    public int duration() {
        if (mp != null && prepared) return mp.getDuration();
        Track t = current();
        return t != null ? t.duration * 1000 : 0;
    }

    public void play(List<Track> tracks, int at, boolean isWave, String from) {
        source = from;
        queue.clear();
        queue.addAll(tracks);
        wave = isWave;
        start(at);
    }

    public void toggle() {
        if (mp == null || !prepared) {
            if (current() != null && error != null) start(index);
            return;
        }
        if (mp.isPlaying()) mp.pause();
        else mp.start();
        changed();
    }

    public void next() {
        if (index + 1 < queue.size()) start(index + 1);
    }

    public void prev() {
        if (position() > 5000 || index == 0) seek(0);
        else if (index > 0) start(index - 1);
    }

    public void seek(int ms) {
        if (mp != null && prepared) mp.seekTo(ms);
        changed();
    }

    private void start(final int at) {
        if (at < 0 || at >= queue.size() || ya == null) return;
        index = at;
        error = null;
        lyrics = null;
        prepared = false;
        release();
        final int my = ++token;
        final Track t = queue.get(at);
        ctx.startService(new Intent(ctx, PlayerService.class));
        changed();
        Bg.run(new Bg.Job<String>() {
            @Override
            public String run() throws Exception {
                return LocalProxy.get().register(ya.streamUrl(t.id));
            }
        }, new Bg.Done<String>() {
            @Override
            public void ok(String url) {
                if (my != token) return;
                open(url, my);
            }

            @Override
            public void fail(Exception e) {
                if (my != token) return;
                error = e.getMessage() != null ? e.getMessage() : "Не удалось загрузить трек";
                changed();
            }
        });
        Bg.run(new Bg.Job<Lrc>() {
            @Override
            public Lrc run() {
                return Lrc.parse(ya.lyrics(t.id));
            }
        }, new Bg.Done<Lrc>() {
            @Override
            public void ok(Lrc value) {
                if (my != token) return;
                lyrics = value;
                changed();
            }

            @Override
            public void fail(Exception e) {
                // без текста
            }
        });
        if (wave && at >= queue.size() - 2) more();
    }

    private void open(String url, final int my) {
        try {
            mp = new MediaPlayer();
            mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
            mp.setWakeMode(ctx, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setDataSource(url);
            mp.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                @Override
                public void onPrepared(MediaPlayer p) {
                    if (my != token) return;
                    prepared = true;
                    p.start();
                    changed();
                }
            });
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer p) {
                    if (my != token) return;
                    if (index + 1 < queue.size()) start(index + 1);
                    else changed();
                }
            });
            mp.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer p, int what, int extra) {
                    if (my != token) return true;
                    error = "Плеер не смог открыть поток (" + what + "/" + extra + ")";
                    prepared = false;
                    changed();
                    return true;
                }
            });
            mp.prepareAsync();
        } catch (Exception e) {
            error = "Плеер: " + e.getMessage();
            changed();
        }
    }

    /** Догрузить волну, когда очередь подходит к концу */
    private void more() {
        if (loadingMore || ya == null) return;
        loadingMore = true;
        final String last = queue.isEmpty() ? null : queue.get(queue.size() - 1).id;
        Bg.run(new Bg.Job<List<Track>>() {
            @Override
            public List<Track> run() throws Exception {
                return ya.wave(last);
            }
        }, new Bg.Done<List<Track>>() {
            @Override
            public void ok(List<Track> value) {
                loadingMore = false;
                if (!wave) return;
                for (Track t : value) {
                    boolean dup = false;
                    for (Track q : queue) if (q.id.equals(t.id)) dup = true;
                    if (!dup) queue.add(t);
                }
                changed();
            }

            @Override
            public void fail(Exception e) {
                loadingMore = false;
            }
        });
    }

    private void release() {
        if (mp != null) {
            try {
                mp.reset();
                mp.release();
            } catch (Exception ignored) {
                // уже освобождён
            }
            mp = null;
        }
    }

    public void stop() {
        token++;
        release();
        prepared = false;
        changed();
    }
}
