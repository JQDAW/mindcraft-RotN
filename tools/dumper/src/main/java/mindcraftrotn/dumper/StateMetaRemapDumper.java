package mindcraftrotn.dumper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.google.gson.stream.JsonWriter;

import net.minecraft.block.Block;
import net.minecraft.block.state.IBlockState;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

/**
 * state-meta-remap.json (lead request after net-forge's G2 finding): the network block-state ids
 * whose metadata is not (id &amp; 15).
 *
 * Forge fills Block.BLOCK_STATE_IDS (GameData$BlockCallbacks.onAdd) in two passes per block:
 * every valid state gets id &lt;&lt; 4 | getMetaFromState(state), then for each used meta m,
 * getStateFromMeta(m) gets id &lt;&lt; 4 | m, and the later put wins. So for BlockDoublePlant the
 * upper half state (getStateFromMeta(8..11) is one state) has network id 175 &lt;&lt; 4 | 11, but its
 * getMetaFromState is 10, which is what a Forge client and /testforblock report.
 *
 * {"format", "encoding": "networkId = blockId << 4 | meta",
 *  "remap": [{networkId, block, blockId, idMeta, stateMeta, stateNetworkId, state}],
 *  "scanned": {blocks, networkIds, validStates, mapIds},
 *  "anomalies": {encodingMismatches, foreignStates, unscannedIds, first}}
 *
 * For every registered block (sorted by id) and every m in 0..15, networkId = id &lt;&lt; 4 | m is
 * resolved with BLOCK_STATE_IDS.getByValue (what a client does with an id it receives); ids that
 * resolve to no state are skipped. A record is written only where idMeta = networkId &amp; 15 differs
 * from stateMeta = the resolved state's getMetaFromState. stateNetworkId = BLOCK_STATE_IDS.get(state),
 * the id the server sends for that state; state = the state's toString.
 *
 * Guards (the importer refuses the part unless both are 0): encodingMismatches counts valid states
 * whose BLOCK_STATE_IDS id is not their own block's id &lt;&lt; 4 | something (the scan above assumes
 * that encoding; REID raises the block id limit and could change it); foreignStates counts network
 * ids that resolve to a state of another block. Read only: no state is changed.
 *
 * Map size (0.2.1, #80 review): mapIds counts the ids in BLOCK_STATE_IDS that hold a state (its
 * iterator skips empty slots). unscannedIds = mapIds - networkIds must be 0: otherwise the map holds
 * ids the per-block scan never reached. Null when the map cannot be read; the importer treats that
 * as non-zero. (The map's size(), its distinct states, is not compared: Forge never removes a state
 * from it, so a replaced block's old states could stay without changing what any id resolves to.)
 *
 * Errors (0.2.1, #80 review): each valid state is checked on its own; a state whose network id
 * cannot be read counts as an encoding mismatch. An entry that throws (Part drops it and counts it in
 * entryErrors) leaves every counter and the first anomaly as they were before it, so the scanned
 * counts cover only entries that were written or skipped normally.
 */
final class StateMetaRemapDumper extends Part<Integer> {
    private int blocks;
    private int networkIds;
    private int validStates;
    private int encodingMismatches;
    private int foreignStates;
    private String firstAnomaly;

    @SuppressWarnings("deprecation")
    private static IBlockState byNetworkId(int nid) {
        return Block.BLOCK_STATE_IDS.getByValue(nid);
    }

    @SuppressWarnings("deprecation")
    private static int networkIdOf(IBlockState s) {
        return Block.BLOCK_STATE_IDS.get(s);
    }

    private static String nameOf(Block b) {
        ResourceLocation r = b == null ? null : b.getRegistryName();
        return r == null ? null : r.toString();
    }

    private void anomaly(String what) {
        if (firstAnomaly == null) firstAnomaly = what;
    }

    @Override
    protected List<Integer> entries() {
        List<Integer> ids = new ArrayList<>();
        for (Block b : ForgeRegistries.BLOCKS.getValuesCollection()) {
            Integer id = J.get(() -> Block.getIdFromBlock(b));
            if (id == null || id < 0) continue;
            ids.add(id);
        }
        ids.sort(null);
        blocks = ids.size();
        List<Integer> nids = new ArrayList<>(ids.size() * 16);
        for (int id : ids) for (int m = 0; m < 16; m++) nids.add(id << 4 | m);
        return nids;
    }

    @Override
    protected void head(JsonWriter w) throws IOException {
        w.beginObject();
        J.str(w, "format", RotnDump.FORMAT);
        J.str(w, "encoding", "networkId = blockId << 4 | meta");
        w.name("remap").beginArray();
    }

    @Override
    protected boolean entry(JsonWriter w, Integer nid) throws IOException {
        int[] before = {networkIds, validStates, encodingMismatches, foreignStates};
        String firstBefore = firstAnomaly;
        try {
            return scan(w, nid);
        } catch (Throwable t) {
            // Part drops this entry; roll the counters back so they only count finished entries.
            networkIds = before[0];
            validStates = before[1];
            encodingMismatches = before[2];
            foreignStates = before[3];
            firstAnomaly = firstBefore;
            throw t;
        }
    }

    private boolean scan(JsonWriter w, int nid) throws IOException {
        int blockId = nid >> 4;
        int idMeta = nid & 15;
        Block owner = Block.getBlockById(blockId);
        if (idMeta == 0) checkEncoding(owner, blockId);
        IBlockState s = byNetworkId(nid);
        if (s == null) return false;
        networkIds++;
        Block b = s.getBlock();
        if (b != owner) {
            foreignStates++;
            anomaly("networkId " + nid + " (block id " + blockId + ", " + nameOf(owner) + ") resolves to " + s);
        }
        int stateMeta = b.getMetaFromState(s);
        if (stateMeta == idMeta) return false;
        w.beginObject();
        J.num(w, "networkId", nid);
        J.str(w, "block", nameOf(b));
        J.num(w, "blockId", blockId);
        J.num(w, "idMeta", idMeta);
        J.num(w, "stateMeta", stateMeta);
        J.num(w, "stateNetworkId", J.get(() -> networkIdOf(s)));
        J.str(w, "state", J.get(s::toString));
        w.endObject();
        return true;
    }

    /**
     * Every valid state of the block must have a network id of this block (id << 4 | 0..15). Each
     * state is guarded on its own: one whose id cannot be read is a mismatch, and the rest are still
     * checked.
     */
    private void checkEncoding(Block owner, int blockId) {
        if (owner == null) return;
        for (IBlockState s : owner.getBlockState().getValidStates()) {
            validStates++;
            Integer sid = J.get(() -> networkIdOf(s));
            if (sid == null || sid >> 4 != blockId) {
                encodingMismatches++;
                String name = J.get(s::toString);
                anomaly("state " + name + " of block id " + blockId + (sid == null ? ": network id unreadable" : " has network id " + sid));
            }
        }
    }

    /**
     * Ids in BLOCK_STATE_IDS that hold a state (the iterator skips empty slots; null is skipped here
     * too); null if unreadable. The loop variable is Object: this Forge build's iterator yields
     * Object, so an IBlockState loop variable does not compile (PR #87 dumper-build).
     */
    @SuppressWarnings("deprecation")
    private static Integer mapIds() {
        return J.get(() -> {
            int n = 0;
            for (Object s : Block.BLOCK_STATE_IDS) if (s != null) n++;
            return n;
        });
    }

    @Override
    protected void tail(JsonWriter w) throws IOException {
        w.endArray();
        w.name("scanned").beginObject();
        J.num(w, "blocks", blocks);
        J.num(w, "networkIds", networkIds);
        J.num(w, "validStates", validStates);
        Integer ids = mapIds();
        J.num(w, "mapIds", ids);
        w.endObject();
        w.name("anomalies").beginObject();
        J.num(w, "encodingMismatches", encodingMismatches);
        J.num(w, "foreignStates", foreignStates);
        J.num(w, "unscannedIds", ids == null ? null : ids - networkIds);
        J.str(w, "first", firstAnomaly);
        w.endObject();
        w.endObject();
    }
}
