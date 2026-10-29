package org.nyao.legacy;

import android.app.Activity;
import android.graphics.PorterDuff;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

/** Экран «Сейчас играет»: обложка, три строки текста, перемотка и кнопки */
public class PlayerActivity extends Activity {
    private Player player;
    private ImageView cover;
    private TextView title;
    private TextView artist;
    private TextView source;
    private TextView like;
    private TextView pos;
    private TextView dur;
    private TextView error;
    private TextView lPrev;
    private TextView lNow;
    private TextView lNext;
    private View lyrics;
    private SeekBar seek;
    private ImageButton toggle;
    private boolean dragging;
    private String shownId;

    private final Runnable onPlayer = new Runnable() {
        @Override
        public void run() {
            render();
        }
    };
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            progress();
            Bg.UI.postDelayed(this, 300);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.player);
        player = Player.get(this);
        cover = (ImageView) findViewById(R.id.cover);
        title = (TextView) findViewById(R.id.title);
        artist = (TextView) findViewById(R.id.artist);
        source = (TextView) findViewById(R.id.source);
        like = (TextView) findViewById(R.id.like);
        pos = (TextView) findViewById(R.id.pos);
        dur = (TextView) findViewById(R.id.dur);
        error = (TextView) findViewById(R.id.error);
        lPrev = (TextView) findViewById(R.id.lPrev);
        lNow = (TextView) findViewById(R.id.lNow);
        lNext = (TextView) findViewById(R.id.lNext);
        lyrics = findViewById(R.id.lyrics);
        seek = (SeekBar) findViewById(R.id.seek);
        toggle = (ImageButton) findViewById(R.id.toggle);
        toggle.setColorFilter(0xFF15121F, PorterDuff.Mode.SRC_ATOP);

        findViewById(R.id.back).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                player.toggle();
            }
        });
        findViewById(R.id.next).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                player.next();
            }
        });
        findViewById(R.id.prev).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                player.prev();
            }
        });
        like.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleLike();
            }
        });
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                if (fromUser) pos.setText(time((long) player.duration() * progress / 1000));
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) {
                dragging = true;
            }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
                dragging = false;
                player.seek((int) ((long) player.duration() * s.getProgress() / 1000));
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        player.addListener(onPlayer);
        render();
        tick.run();
    }

    @Override
    protected void onPause() {
        player.removeListener(onPlayer);
        Bg.UI.removeCallbacks(tick);
        super.onPause();
    }

    private void render() {
        Track t = player.current();
        if (t == null) {
            finish();
            return;
        }
        source.setText(player.source);
        title.setText(t.title);
        artist.setText(t.artist);
        if (!t.id.equals(shownId)) {
            shownId = t.id;
            Images.load(cover, t.coverUrl(400), 0xFFFFD60A);
        }
        boolean liked = NyaoApp.ya != null && NyaoApp.ya.liked.contains(t.id);
        like.setTextColor(liked ? 0xFFF0574A : 0xFF55556A);
        toggle.setImageResource(player.playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        error.setVisibility(player.error != null ? View.VISIBLE : View.GONE);
        if (player.error != null) error.setText(player.error + " · нажмите ▶, чтобы повторить");
        lyrics.setVisibility(player.lyrics != null ? View.VISIBLE : View.GONE);
        progress();
    }

    private void progress() {
        int d = player.duration();
        int p = player.position();
        if (!dragging) {
            seek.setProgress(d > 0 ? (int) (1000L * p / d) : 0);
            pos.setText(player.loading() ? "загрузка…" : time(p));
        }
        dur.setText(time(d));
        Lrc l = player.lyrics;
        if (l != null) {
            int i = l.at(p);
            lPrev.setText(i > 0 ? l.lines.get(i - 1) : "");
            lNow.setText(i >= 0 ? l.lines.get(i) : "♪");
            lNext.setText(i + 1 < l.lines.size() ? l.lines.get(i + 1) : "");
        }
    }

    private void toggleLike() {
        final Track t = player.current();
        if (t == null || NyaoApp.ya == null) return;
        final boolean on = !NyaoApp.ya.liked.contains(t.id);
        Bg.run(new Bg.Job<Boolean>() {
            @Override
            public Boolean run() throws Exception {
                NyaoApp.ya.like(t, on);
                return on;
            }
        }, new Bg.Done<Boolean>() {
            @Override
            public void ok(Boolean value) {
                render();
            }

            @Override
            public void fail(Exception e) {
                Toast.makeText(PlayerActivity.this, "Не получилось: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    static String time(long ms) {
        long s = Math.max(0, ms / 1000);
        return s / 60 + ":" + String.format("%02d", s % 60);
    }
}
