package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.List;

import com.google.gson.stream.JsonWriter;

/**
 * One output file, written in batches across server ticks (PR #34 review): begin() once, then
 * entry(i) for i in 0..size()-1, at most RotnDump.BATCH entries per tick, then end().
 * The JsonWriter stays open between ticks; the file is renamed into place after end().
 */
abstract class Part<T> {
    private List<T> list;

    /** Build the list of entries (runs in the first tick of the part). */
    protected abstract List<T> entries();

    /** Write everything before the first entry. */
    protected abstract void head(JsonWriter w) throws IOException;

    /** Write one entry; return true if something was written (counted). */
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
        return entry(w, list.get(i));
    }

    final void end(JsonWriter w) throws IOException {
        tail(w);
    }
}
