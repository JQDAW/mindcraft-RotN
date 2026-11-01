package mindcraftrotn.dumper;

import java.io.IOException;
import java.io.StringWriter;
import java.util.List;

import com.google.gson.stream.JsonWriter;

/**
 * One output file, written in batches across server ticks (PR #34 review): begin() once, then
 * write(i) for i in 0..size()-1, bounded per tick by RotnDump.BATCH entries and
 * RotnDump.TICK_BUDGET_MS, then end(). The JsonWriter stays open between ticks; the file is
 * renamed into place after end().
 *
 * Each entry is rendered into its own buffer first (PR #34 follow-up 2): if it throws, only that
 * entry is dropped and counted in entryErrors, never the whole file. The writers are strict (not
 * lenient), so a NaN or infinite double makes its entry throw and be dropped, never invalid JSON. Object-style parts return
 * the entry's key from key(); array-style parts return null.
 */
abstract class Part<T> {
    private List<T> list;
    int entryErrors;
    String firstEntryError;

    /** Build the list of entries (runs in the first tick of the part). */
    protected abstract List<T> entries();

    /** Write everything before the first entry. */
    protected abstract void head(JsonWriter w) throws IOException;

    /** The entry's key in the parent object, or null when the parent is an array. */
    protected String key(T e) {
        return null;
    }

    /** Write one entry's value; return false to skip it (nothing written, not counted). */
    protected abstract boolean entry(JsonWriter w, T e) throws IOException;

    /** Write everything after the last entry. */
    protected abstract void tail(JsonWriter w) throws IOException;

    final void begin(JsonWriter w) throws IOException {
        list = entries();
        head(w);
    }

    final int size() {
        return list.size();
    }

    final boolean write(JsonWriter w, int i) throws IOException {
        T e = list.get(i);
        String json;
        String k;
        try {
            StringWriter sw = new StringWriter();
            JsonWriter bw = new JsonWriter(sw);
            bw.setSerializeNulls(true);
            if (!entry(bw, e)) return false;
            bw.flush();
            json = sw.toString();
            k = key(e);
        } catch (Throwable t) {
            entryErrors++;
            if (firstEntryError == null) firstEntryError = "entry " + i + ": " + t;
            return false;
        }
        if (json.isEmpty()) return false;
        if (k != null) w.name(k);
        w.jsonValue(json);
        return true;
    }

    final void end(JsonWriter w) throws IOException {
        tail(w);
    }
}
