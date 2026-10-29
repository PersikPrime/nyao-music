package org.nyao.legacy;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** Главная: «Моя волна», «Мне нравится», поиск и мини-плеер */
public class MainActivity extends Activity {
    private final List<Track> items = new ArrayList<Track>();
    private List<Track> likes = new ArrayList<Track>();
    private TrackAdapter adapter;
    private ListView list;
    private TextView empty;
    private TextView section;
    private TextView titleView;
    private EditText query;
    private View header;
    private boolean searching;
    private Player player;

    private View mini;
    private ProgressBar miniProgress;
    private ImageView miniCover;
    private TextView miniTitle;
    private TextView miniArtist;
    private ImageButton miniToggle;

    private final Runnable onPlayer = new Runnable() {
        @Override
        public void run() {
            renderMini();
            adapter.notifyDataSetChanged();
        }
    };
    private final Runnable progress = new Runnable() {
        @Override
        public void run() {
            int d = player.duration();
            miniProgress.setProgress(d > 0 ? (int) (1000L * player.position() / d) : 0);
            Bg.UI.postDelayed(this, 500);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NyaoApp.store.paired()) {
            startActivity(new Intent(this, PairActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.main);
        player = Player.get(this);
        player.setYandex(NyaoApp.ya);
        list = (ListView) findViewById(R.id.list);
        empty = (TextView) findViewById(R.id.empty);
        titleView = (TextView) findViewById(R.id.title);
        query = (EditText) findViewById(R.id.query);
        header = LayoutInflater.from(this).inflate(R.layout.header_home, list, false);
        section = (TextView) header.findViewById(R.id.section);
        list.addHeaderView(header, null, false);
        adapter = new TrackAdapter(this, items);
        list.setAdapter(adapter);
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                int i = position - list.getHeaderViewsCount();
                if (i < 0 || i >= items.size()) return;
                player.play(new ArrayList<Track>(items), i, false, searching ? "Поиск" : "Мне нравится");
                startActivity(new Intent(MainActivity.this, PlayerActivity.class));
            }
        });
        header.findViewById(R.id.wavePlay).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startWave();
            }
        });
        header.findViewById(R.id.waveTile).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startWave();
            }
        });
        findViewById(R.id.search).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (!searching) openSearch();
                else runSearch();
            }
        });
        query.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEARCH || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                    runSearch();
                    return true;
                }
                return false;
            }
        });
        findViewById(R.id.menu).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMenu(v);
            }
        });

        mini = findViewById(R.id.mini);
        miniProgress = (ProgressBar) findViewById(R.id.miniProgress);
        miniCover = (ImageView) findViewById(R.id.miniCover);
        miniTitle = (TextView) findViewById(R.id.miniTitle);
        miniArtist = (TextView) findViewById(R.id.miniArtist);
        miniToggle = (ImageButton) findViewById(R.id.miniToggle);
        mini.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, PlayerActivity.class));
            }
        });
        miniToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                player.toggle();
            }
        });
        findViewById(R.id.miniNext).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                player.next();
            }
        });
        loadLikes();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player == null) return;
        player.addListener(onPlayer);
        renderMini();
        progress.run();
    }

    @Override
    protected void onPause() {
        if (player != null) player.removeListener(onPlayer);
        Bg.UI.removeCallbacks(progress);
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (searching) closeSearch();
        else super.onBackPressed();
    }

    private void showEmpty(String text) {
        empty.setText(text);
        empty.setVisibility(text == null ? View.GONE : View.VISIBLE);
    }

    private void loadLikes() {
        if (NyaoApp.ya == null) {
            showEmpty("Яндекс Музыка не подключена. YouTube Music появится в следующей версии.");
            return;
        }
        section.setText("МНЕ НРАВИТСЯ · ЗАГРУЖАЕМ…");
        Bg.run(new Bg.Job<List<Track>>() {
            @Override
            public List<Track> run() throws Exception {
                return NyaoApp.ya.likes();
            }
        }, new Bg.Done<List<Track>>() {
            @Override
            public void ok(List<Track> value) {
                likes = value;
                section.setText("МНЕ НРАВИТСЯ · " + value.size());
                if (!searching) setItems(likes);
            }

            @Override
            public void fail(Exception e) {
                section.setText("МНЕ НРАВИТСЯ");
                showEmpty("Не удалось загрузить: " + e.getMessage());
            }
        });
    }

    private void setItems(List<Track> v) {
        items.clear();
        items.addAll(v);
        adapter.notifyDataSetChanged();
        showEmpty(null);
    }

    private void startWave() {
        if (NyaoApp.ya == null) return;
        final TextView sub = (TextView) header.findViewById(R.id.waveSub);
        sub.setText("Подбираем треки…");
        Bg.run(new Bg.Job<List<Track>>() {
            @Override
            public List<Track> run() throws Exception {
                return NyaoApp.ya.wave(null);
            }
        }, new Bg.Done<List<Track>>() {
            @Override
            public void ok(List<Track> value) {
                sub.setText("Яндекс Музыка");
                if (value.isEmpty()) return;
                player.play(value, 0, true, "Моя волна");
                startActivity(new Intent(MainActivity.this, PlayerActivity.class));
            }

            @Override
            public void fail(Exception e) {
                sub.setText("Ошибка: " + e.getMessage());
            }
        });
    }

    private void openSearch() {
        searching = true;
        titleView.setVisibility(View.GONE);
        findViewById(R.id.logo).setVisibility(View.GONE);
        query.setVisibility(View.VISIBLE);
        query.requestFocus();
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(query, InputMethodManager.SHOW_IMPLICIT);
        header.findViewById(R.id.waveTile).setVisibility(View.GONE);
        section.setText("ПОИСК");
        setItems(new ArrayList<Track>());
    }

    private void closeSearch() {
        searching = false;
        query.setText("");
        query.setVisibility(View.GONE);
        titleView.setVisibility(View.VISIBLE);
        findViewById(R.id.logo).setVisibility(View.VISIBLE);
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(query.getWindowToken(), 0);
        header.findViewById(R.id.waveTile).setVisibility(View.VISIBLE);
        section.setText("МНЕ НРАВИТСЯ · " + likes.size());
        setItems(likes);
    }

    private void runSearch() {
        final String text = query.getText().toString().trim();
        if (text.length() == 0 || NyaoApp.ya == null) return;
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(query.getWindowToken(), 0);
        section.setText("ПОИСК · ИЩЕМ…");
        Bg.run(new Bg.Job<List<Track>>() {
            @Override
            public List<Track> run() throws Exception {
                return NyaoApp.ya.search(text);
            }
        }, new Bg.Done<List<Track>>() {
            @Override
            public void ok(List<Track> value) {
                if (!searching) return;
                section.setText("ПОИСК · " + value.size());
                setItems(value);
                if (value.isEmpty()) showEmpty("Ничего не нашлось");
            }

            @Override
            public void fail(Exception e) {
                section.setText("ПОИСК");
                showEmpty("Ошибка: " + e.getMessage());
            }
        });
    }

    private void showMenu(View anchor) {
        PopupMenu m = new PopupMenu(this, anchor);
        m.getMenu().add(0, 1, 0, "Обновить");
        m.getMenu().add(0, 2, 0, "Проверка связи");
        m.getMenu().add(0, 3, 0, "Выйти" + (NyaoApp.store.get("userName") != null ? " (" + NyaoApp.store.get("userName") + ")" : ""));
        m.setOnMenuItemClickListener(new PopupMenu.OnMenuItemClickListener() {
            @Override
            public boolean onMenuItemClick(MenuItem item) {
                if (item.getItemId() == 1) loadLikes();
                else if (item.getItemId() == 2) startActivity(new Intent(MainActivity.this, ProbeActivity.class));
                else if (item.getItemId() == 3) {
                    player.stop();
                    NyaoApp.store.clear();
                    NyaoApp.refreshServices();
                    startActivity(new Intent(MainActivity.this, PairActivity.class));
                    finish();
                }
                return true;
            }
        });
        m.show();
    }

    private void renderMini() {
        Track t = player.current();
        mini.setVisibility(t == null ? View.GONE : View.VISIBLE);
        if (t == null) return;
        miniTitle.setText(t.title);
        miniArtist.setText(player.error != null ? player.error : t.artist);
        Images.load(miniCover, t.coverUrl(100), 0xFFFFD60A);
        miniToggle.setImageResource(player.playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
    }

    static class TrackAdapter extends BaseAdapter {
        private final Context ctx;
        private final List<Track> data;
        private static final int[] COLORS = {0xFFF0574A, 0xFFCFC4FF, 0xFF3FBFA0, 0xFFFFD60A, 0xFF6F8BFF};

        TrackAdapter(Context ctx, List<Track> data) {
            this.ctx = ctx;
            this.data = data;
        }

        @Override
        public int getCount() {
            return data.size();
        }

        @Override
        public Object getItem(int position) {
            return data.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View v, ViewGroup parent) {
            if (v == null) v = LayoutInflater.from(ctx).inflate(R.layout.row_track, parent, false);
            Track t = data.get(position);
            Track cur = Player.get(ctx).current();
            TextView title = (TextView) v.findViewById(R.id.title);
            title.setText(t.title);
            title.setTextColor(cur != null && cur.id.equals(t.id) ? 0xFFCFC4FF : 0xFFF2F2F5);
            ((TextView) v.findViewById(R.id.artist)).setText(t.artist);
            boolean liked = NyaoApp.ya != null && NyaoApp.ya.liked.contains(t.id);
            v.findViewById(R.id.heart).setVisibility(liked ? View.VISIBLE : View.INVISIBLE);
            v.setAlpha(t.available ? 1f : 0.4f);
            Images.load((ImageView) v.findViewById(R.id.cover), t.coverUrl(100), COLORS[position % COLORS.length]);
            return v;
        }
    }
}
