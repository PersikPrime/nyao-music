package org.nyao.legacy;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Текст песни LRC: строки с временем */
public final class Lrc {
    public final List<Long> times = new ArrayList<Long>();
    public final List<String> lines = new ArrayList<String>();

    private static final Pattern P = Pattern.compile("\\[(\\d+):(\\d+)(?:[.:](\\d+))?\\]");

    public static Lrc parse(String text) {
        if (text == null) return null;
        Lrc l = new Lrc();
        for (String raw : text.split("\n")) {
            Matcher m = P.matcher(raw);
            List<Long> ts = new ArrayList<Long>();
            int end = 0;
            while (m.find() && m.start() == end) {
                long ms = Long.parseLong(m.group(1)) * 60000 + Long.parseLong(m.group(2)) * 1000;
                if (m.group(3) != null) {
                    String f = (m.group(3) + "00").substring(0, 3);
                    ms += Long.parseLong(f);
                }
                ts.add(ms);
                end = m.end();
            }
            if (ts.isEmpty()) continue;
            String line = raw.substring(end).trim();
            for (Long t : ts) {
                int i = 0;
                while (i < l.times.size() && l.times.get(i) <= t) i++;
                l.times.add(i, t);
                l.lines.add(i, line.length() > 0 ? line : "♪");
            }
        }
        return l.times.isEmpty() ? null : l;
    }

    /** Индекс строки, которая звучит сейчас (-1 — ещё до первой) */
    public int at(long ms) {
        int i = -1;
        for (int k = 0; k < times.size(); k++) {
            if (times.get(k) <= ms + 150) i = k;
            else break;
        }
        return i;
    }
}
