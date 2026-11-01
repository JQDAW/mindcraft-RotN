package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.concurrent.Callable;

import com.google.gson.stream.JsonWriter;

/**
 * Write helpers. Rule (PR #34 review): a value is computed first, inside {@link #get}, which turns
 * any Throwable into null; only then are the name and the value (or null) written. A throwing
 * game call can therefore never leave the JsonWriter with a dangling name.
 */
final class J {
    private J() {
    }

    static <T> T get(Callable<T> c) {
        try {
            return c.call();
        } catch (Throwable t) {
            return null;
        }
    }

    static void str(JsonWriter w, String k, String v) throws IOException {
        w.name(k);
        if (v == null) w.nullValue();
        else w.value(v);
    }

    static void num(JsonWriter w, String k, Number v) throws IOException {
        w.name(k);
        if (v == null || (v instanceof Double && !Double.isFinite((Double) v)) || (v instanceof Float && !Float.isFinite((Float) v))) w.nullValue();
        else w.value(v);
    }

    static void bool(JsonWriter w, String k, Boolean v) throws IOException {
        w.name(k);
        if (v == null) w.nullValue();
        else w.value(v.booleanValue());
    }
}
