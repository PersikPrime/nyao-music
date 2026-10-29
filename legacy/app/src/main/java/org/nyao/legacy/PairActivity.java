package org.nyao.legacy;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import org.json.JSONObject;

/** Вход по коду: код подтверждается в основном Nyao */
public class PairActivity extends Activity {
    private TextView code;
    private TextView expires;
    private TextView status;
    private View spin;
    private Pairing pairing;
    private boolean alive;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!alive || pairing == null) return;
            long left = (pairing.expiresAt - System.currentTimeMillis()) / 1000;
            if (left <= 0) {
                expires.setText("Код устарел");
                status.setText("Нажмите «Новый код»");
                spin.setVisibility(View.INVISIBLE);
                pairing = null;
                return;
            }
            expires.setText(String.format("Код действует %d:%02d", left / 60, left % 60));
            Bg.UI.postDelayed(this, 1000);
        }
    };

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (!alive || pairing == null) return;
            final Pairing p = pairing;
            Bg.run(new Bg.Job<JSONObject>() {
                @Override
                public JSONObject run() throws Exception {
                    return p.poll();
                }
            }, new Bg.Done<JSONObject>() {
                @Override
                public void ok(JSONObject o) {
                    if (p != pairing) return;
                    if (o == null) {
                        Bg.UI.postDelayed(poll, 3000);
                        return;
                    }
                    complete(o);
                }

                @Override
                public void fail(Exception e) {
                    if (p != pairing) return;
                    if (e instanceof Net.HttpException && ((Net.HttpException) e).code == 410) {
                        pairing = null;
                        status.setText("Код устарел — нажмите «Новый код»");
                        spin.setVisibility(View.INVISIBLE);
                        return;
                    }
                    status.setText("Нет связи, пробуем ещё… (" + e.getMessage() + ")");
                    Bg.UI.postDelayed(poll, 5000);
                }
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (NyaoApp.store.paired()) {
            startActivity(new Intent(this, MainActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.pair);
        code = (TextView) findViewById(R.id.code);
        expires = (TextView) findViewById(R.id.expires);
        status = (TextView) findViewById(R.id.status);
        spin = findViewById(R.id.spin);
        findViewById(R.id.newCode).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                begin();
            }
        });
        findViewById(R.id.probe).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(PairActivity.this, ProbeActivity.class));
            }
        });
        if (NyaoApp.netError != null) status.setText("Ошибка TLS: " + NyaoApp.netError);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (code == null) return;
        alive = true;
        if (pairing == null) begin();
        else {
            tick.run();
            poll.run();
        }
    }

    @Override
    protected void onPause() {
        alive = false;
        Bg.UI.removeCallbacks(tick);
        Bg.UI.removeCallbacks(poll);
        super.onPause();
    }

    private void begin() {
        pairing = null;
        code.setText("··· ···");
        expires.setText("");
        status.setText("Готовим код…");
        spin.setVisibility(View.VISIBLE);
        Bg.run(new Bg.Job<Pairing>() {
            @Override
            public Pairing run() throws Exception {
                return Pairing.start(Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE);
            }
        }, new Bg.Done<Pairing>() {
            @Override
            public void ok(Pairing p) {
                pairing = p;
                code.setText(p.code.substring(0, 3) + " " + p.code.substring(3));
                status.setText("Ждём подтверждения…");
                Bg.UI.removeCallbacks(tick);
                Bg.UI.removeCallbacks(poll);
                tick.run();
                Bg.UI.postDelayed(poll, 3000);
            }

            @Override
            public void fail(Exception e) {
                spin.setVisibility(View.INVISIBLE);
                status.setText("Не получилось связаться с Nyao: " + e.getMessage());
            }
        });
    }

    private void complete(JSONObject o) {
        JSONObject d = o.optJSONObject("data");
        Store s = NyaoApp.store;
        s.put("nyaoToken", o.optString("token"));
        JSONObject u = o.optJSONObject("user");
        if (u != null) s.put("userName", u.optString("name"));
        if (d != null) {
            String ya = d.optString("yandexToken", "");
            String yt = d.optString("ytCookie", "");
            if (ya.length() > 0) s.put("yandexToken", ya);
            if (yt.length() > 0) s.put("ytCookie", yt);
        }
        NyaoApp.refreshServices();
        if (!s.paired()) {
            status.setText("Подключено, но в основном Nyao не вошли ни в Яндекс, ни в YouTube Music");
            spin.setVisibility(View.INVISIBLE);
            return;
        }
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
