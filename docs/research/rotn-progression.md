# RotN 3.3.2 early game: progression graph, hazards, first-day script, item names

- Source: `rotn-gameplay-analyst` subagent, 2026-10-31, filed by rotn-lead on 2026-11-01. Input, not a decision.
- **Pack version note (2026-11-01):** the project now targets **RotN 3.3.4** (ADR 0005). This report was researched against 3.3.2. The lead re-checked the early-game recipes in the 3.3.4 zip's own `scripts/`, and they are unchanged: Crafting Tools, crafting table, crude axe, rocks to cobblestone, stone axe. Re-check anything else against the 3.3.4 zip before relying on it. The 3.3.4 repo reference is commit `775cc6e7`.
- **Lead checks (2026-11-01), done with `gh api` against the pack repo:**
  - Commit `bd2d078d…` is titled "3.3.2" and its `pack_version_number.json` reads `{"version": "3.3.2"}`. The commit message links CurseForge file 7219585, the client pack named in section A.
  - `scripts/crafting_tables.zs` line 9 (Crafting Tools) and `scripts/pyrotech/pyrotech_recipes_craftingtable.zs` lines 238-240 (crude axe) match this report exactly.
  - `config/RoughlyEnoughIDs.cfg` exists at 3.3.2, and `_server-only/` ships `forge-1.12.2-14.23.5.2860.jar`.
  - `mods/` is a private submodule (`git@github.com:Rebirth-of-the-Night/RotN-Mods`), so the jar list must come from the server zip.
  - Everything else is as the subagent reported. Its fetch tool summarized files rather than returning them byte-exact.

## 0. How to read this report

**Evidence base.** No local pack was available. The pack's source repo is public on GitHub: `Rebirth-of-the-Night/Rebirth-of-the-Night`, branch `stable`.

- **3.3.2 commit.** Commit `bd2d078d933e798ad9f87d3171ca31ddbe6b24f4` is titled "3.3.2" (2025-11-14). Every `[R:...]` citation below is a file at that commit.
- **How to open a file.** Use `https://github.com/Rebirth-of-the-Night/Rebirth-of-the-Night/blob/bd2d078d933e798ad9f87d3171ca31ddbe6b24f4/<path>`.
- **Caveat 1.** The fetch tool summarized the files rather than returning them byte-exact. Treat recipe shapes as high confidence, but have the harness or rotn-data diff them against the real server zip. A concrete way is to read the extracted `scripts/` folder.
- **Caveat 2.** `mods/` is a private submodule, so the jar list cannot be read from the repo.

**Source codes.**

- `[W-x]` is a wiki page, `https://rotn.wiki.gg/wiki/<x>`. The wiki's front page says it is unfinished and still shows 3.3.1 or 3.2.1 as the latest version.
- `[CF]` is CurseForge.
- `[R:path]` is a file in the repo at the 3.3.2 commit.
- `[HB]` is the in-game Survivor's Handbook, at `patchouli_books/survivorshandbook/en_us/entries/...` in the repo.

**Authority.** Repo scripts and configs at the 3.3.2 commit come first, then the wiki, then CurseForge. `UNVERIFIED` means not confirmed for 3.3.2.

**Known starting points: both confirmed.**

- **Crude axe.** `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]`, and the wiki says "Punching trees no longer works" `[W-Getting_Started]`.
- **Rocks to cobblestone.** 4 `pyrotech:rock` make 1 `minecraft:cobblestone` `[R:scripts/minecraft_(max-file-size).zs]`. The script recipe is shapeless; the wiki describes it as a 2x2 grid `[W-Getting_Started]`.

---

## 1. Early-game progression graph (fresh spawn to iron tools)

Item names are 1.12.2 registry names, with metadata after the second colon. "oredict" means a Forge ore dictionary key, and a recipe that uses one accepts all its members.

| # | Step | Inputs | Station | Output | Source and notes |
|---|---|---|---|---|---|
| 0 | Start kit | Given at spawn: Scroll of New Life (`lifescroll` mod, id UNVERIFIED), Bundle (`bundles` mod, id UNVERIFIED), `minecraft:bread` | none | n/a | `[W-Getting_Started]`, `[HB newbeginning/new_world]`. The scroll sets your spawn point instead of a bed; it is single-use, so use it at the base site. When to use it is UNVERIFIED. The bundle holds 128 items. |
| 1 | Get rocks | Break surface rock piles | hand | `pyrotech:rock:0` (stone rock) | `[W-Getting_Started]`: "rocks from rock piles on the ground". Rock generation is enabled in `[R:config/pyrotech/module.WorldGen.cfg]`, but that config whitelists only dimension 7 and blacklists dimension 0; see section B. Whether breaking a pile by hand drops a rock is UNVERIFIED but implied. |
| 2 | Get sticks | Break leaves | hand | `minecraft:stick` | `[W-Getting_Started]` |
| 3 | Crude axe | 1 rock (`pyrotech:rock` or `minecraft:flint`) + 2 `minecraft:stick` | 2x2 inventory grid or table | `pyrotech:crude_axe` | `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]`: `addShaped("pyro_crude_axe")` with rows `[rock\|flint, stick]` and `[stick, empty]`. Durability 8, mining level Crude, speed 2 `[W-Tools]`. It breaks after about 8 uses, so craft 2 to 4. |
| 4 | Fell a tree, get logs | Crude axe on the tree | tree | `minecraft:log:0..3` and `minecraft:log2:0..1` | `[W-Getting_Started]`. The exact log item the tree drops is UNVERIFIED. Trees use a Dynamic Trees fork (changelog 3.2.0: "Dramatic Trees") and fall in the direction you chop `[W-Tips]`. Falling trees can hurt. |
| 5 | Debark a log | Placed log, right-clicked with the crude axe | Hit With Axe mod (`hitwithaxe`) | `hitwithaxe:debarked_oak` (meta 0, 1 or 2 = X, Y or Z axis) + `hitwithaxe:bark:15` for oak | `[W-Getting_Started]`: "Right-click a placed log with the crude axe to strip it for bark." `[R:scripts/wood_stripping_boards.zs]`. The log must be placed in the world first; it works like a chopping block. |
| 6 | First plank | Right-click the debarked log with the axe | same | `minecraft:planks:0` (oak) | `[W-Getting_Started]`, `[HB newbeginning/wood]`. The script maps debarked logs (any meta) to planks. Planks per click are UNVERIFIED; the wiki says "a wooden plank". |
| 7 | Crafting Tools | 1 `pyrotech:crude_axe` (or `minecraft:stone_axe`, any damage) + 1 rock (oredict `rock` or `minecraft:flint`) + 1 stick (oredict `stickWood`) | grid, shapeless | `contenttweaker:crafting_tools` | `[R:scripts/crafting_tables.zs]` line 9, `recipes.addShapeless("crafting_tools")` (lead-verified). The script has no reuse flag, so the axe is probably consumed (UNVERIFIED). Alternative recipe with no axe: oredict `genericMetalNuggets` + stick. |
| 8 | Crafting table | 1 plank (oredict `stickMat`, mirrors `plankWood`) + 1 `contenttweaker:crafting_tools` | grid, shapeless | `minecraft:crafting_table` | `[R:scripts/crafting_tables.zs]`. The vanilla recipe is removed. `[W-Crafting_Table]`: "one wood plank and one Crafting Tools". |
| 9 | Planks in bulk | 1 log | crafting table | 3 `minecraft:planks` | `[W-Getting_Started]` ("putting a log in it yields 3 planks"), `[R:scripts/wood_stripping_boards.zs]` (shaped, 1 log gives 3 planks). Whether it also works in the 2x2 grid is UNVERIFIED. |
| 10 | Sticks | 2 planks stacked vertically | grid | 4 `minecraft:stick` | `[R:scripts/minecraft_(max-file-size).zs]`. The vanilla stick recipe is removed. Shaped column of 2 oredict `stickMat`. |
| 11 | Rocks to cobblestone | 4 rocks of the same type | 2x2 grid | 1 `minecraft:cobblestone` | `[R:scripts/minecraft_(max-file-size).zs]` (shapeless; 1 cobblestone also gives 4 rocks back). `[W-Getting_Started]`: the rocks must be the same stone type. |
| 12 | Stone pickaxe | 3 rocks (oredict `rock`, or `minecraft:flint`) + 2 sticks | 3x3 table | `minecraft:stone_pickaxe` | `[R:scripts/recipe_cohesion.zs]`. Shape: 3 rocks across the top row, then a stick in the middle of each row below. The vanilla recipe is removed. Durability 131, level Crude, speed 4 `[W-Tools]`. |
| 13 | Stone axe | 3 rocks + 2 sticks | 3x3 table | `minecraft:stone_axe` | `[R:scripts/recipe_cohesion.zs]`. Shape (mirrored): rows `[rock, rock]`, `[rock, stick]`, `[_, stick]`. The flint variant has the same shape. |
| 14 | Stone shovel, hoe, sword | not found | n/a | n/a | UNVERIFIED. Weapons are Spartan Weaponry stone variants with twine handles `[HB newbeginning/basic_tools_weapons]`. |
| 15 | Mine stone for rocks | Stone pickaxe on stone | stone | 4 rocks per stone block | `[W-Getting_Started]`, `[W-Stone]`. Any pickaxe below Sturdy drops rocks; Sturdy or better (iron, bronze) drops cobblestone. Breaking stone by hand is UNVERIFIED; `[W-Stone]` says "A pickaxe is needed to break stone effectively". |
| 16 | Furnace | 8 rocks in a ring, centre empty | table | `minecraft:furnace` | `[R:scripts/minecraft_(max-file-size).zs]`, `recipes.addShaped("furnace")`. `[W-Getting_Started]`: furnaces use rocks. |
| 17 | Flint (optional) | 2 `minecraft:gravel` | grid, shapeless | 2 `minecraft:flint` | `[R:scripts/minecraft_(max-file-size).zs]`, recipe `gravel_to_flint`. Flint can replace a rock in steps 3, 7, 12 and 13. |
| 18 | Light | Coal or charcoal + stick | grid | `minecraft:torch` | The BWM torch recipe is removed `[R:scripts/glaretorch.zs]`. No replacement was found, so the vanilla-style recipe is UNVERIFIED. `[W-Getting_Started]`: make torches from surface coal or charcoal. Charcoal needs a Pyrotech pit kiln, not a furnace `[R:scripts/jei_descriptions.zs]`. |
| 19 | Fire starters (no coal) | Tinder + 2 sticks or broken sticks gives a matchstick; hand drill | grid | `pyrotech:tinder`, `contenttweaker:broken_stick` | `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]`, `[HB newbeginning/fire_1]`, `[W-Tips]`. Tinder comes from drying plant fibre; 3 tinder make 3 twine. |
| 20 | Mine iron ore | Stone pickaxe on iron ore | ore | `contenttweaker:raw_iron` | The ore needs pickaxe level 0 (oredict `oreIron`) `[R:config/tool_progression/block_overwrites.cfg]`. `[HB newbeginning/spelunking]` lists Raw Iron as `contenttweaker:raw_iron`. Whether the ore block drops raw iron or itself is UNVERIFIED. |
| 21 | Smelt iron | Raw ore (oredict `rawOreIron`) or ore block (`oreIron`) | Pyrotech Stone Kiln, 6400 ticks (320 s) for raw, 5000 ticks for ore | `minecraft:iron_ingot` | `[R:scripts/pyrotech/pyrotech_recipes_kiln.zs]`. The kiln's registry id, build recipe and multiblock requirements are UNVERIFIED, as is whether the plain furnace smelts iron. |
| 22 | Iron tools | Iron ingots + sticks | table | `minecraft:iron_pickaxe`, `minecraft:iron_axe`, etc. | No override recipe was found in the scripts read. Assume the vanilla shape (3 ingots + 2 sticks), UNVERIFIED. Iron is mining level Sturdy (1), durability 288, speed 6 `[W-Tools]`. Iron ingots also come from hammering at a stone anvil (not followed up). |

**Removed items and traps.**

- **No wooden tools.** Wooden pickaxe, axe, shovel, hoe and sword are hidden and stripped from loot `[R:scripts/minecraft_(max-file-size).zs]`.
- **No Pyrotech workbench.** `pyrotech:worktable` and `worktable_stone` have no recipe `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]`.
- **Drills.** The hand drill stays; `pyrotech:bow_drill` is hidden.
- **No crude hammer.** Its recipe is removed.
- **Beds are rebuilt.** The recipe needs carpet, padding and `betterwithmods` parts, so a bed is not early-game `[R:scripts/minecraft_(max-file-size).zs]`, `[W-Bed]`.

**Contradiction to resolve in the harness.** The in-game handbook says "punch the base until it falls" `[HB newbeginning/wood]`, and `[W-Tips]` says you can "climb most trees and still punch them". The wiki's Getting Started page says punching has not worked "since 3.0", and the pack lead says the same. This report follows the Getting Started page; the handbook text appears to be left over from older versions. Test it in the first harness scenario: punch a log and confirm that nothing drops.

---

## 2. Hazard table

| Hazard | Trigger | Observable warning signs | Recommended reflex | Source |
|---|---|---|---|---|
| Starvation | Hunger reaches 0 | Food bar. `[W-Getting_Started]`: "Starving kills instantly". At 3 drumsticks or fewer you cannot sprint or dodge `[W-Hunger]`. | Eat at food 12 or lower. Keep the starting bread as a last resort. Forage first; early foods restore little. | `[W-Getting_Started]`, `[W-Hunger]` |
| Nightfall | The day is about 20 minutes of a 40-minute cycle; nights are doubled and harder than vanilla `[W-Getting_Started]` | Sky darkening. Hardcore Darkness is on in the Overworld; skylight ranges 0 to 0.3 by moon phase, brightest at full moon `[R:config/hardcoredarkness.cfg]`. | Be sheltered before sunset. Do not rely on vanilla `time` values: Extended Days is installed (`extendeddays.cfg`) and its packet format is UNVERIFIED. Use sky light and the sunset signal. | `[W-Getting_Started]`, `[R:config/hardcoredarkness.cfg]` |
| Zombies | Light below 7 at night, and in ruins | Carry pickaxes or axes, place weak scaffolding, break blocks, inflict hunger. 20 HP, attack 3 on Normal. Parasites may drop when they die. | Fight at a choke point with a shield, or stay sealed in. After killing one that carries a Parasite, move away from it. Retreat if two or more come at once. | `[W-Zombie]`, `[W-Getting_Started]` |
| Skeletons | Night | Erratic movement, better aim | Stay behind cover; do not strafe in open ground. | `[W-Getting_Started]` |
| Spiders | Night | Faster, inflict slowness, other mobs ride them | Kill the spider first; avoid open ground. | `[W-Getting_Started]` |
| Creepers, Fire Creepers | Night; Fire Creepers appear in the Overworld | Hissing, standing still next to you. Fire Creepers explode and can burn dropped items `[W-Tips]` | Back off at once. Do not fight near stored items or wooden walls. | `[W-Getting_Started]`, `[W-Tips]`, `[W-Progression_Stages]` |
| Mobs break in | Mobs with pickaxes dig toward you; humanoids build pillars to climb; Zombie Awareness hears noise | Digging sounds, mobs gathering at the wall | Build walls from cobblestone or stone, not dirt. Keep light out of sight from outside. A dirt shack is not safe. | `[W-Tips]`, `[W-Getting_Started]`, `[HB survival/shelter/shelter_early]` |
| Light attracts mobs | Torches in view | Many mobs break light sources | Keep light out of sight from outside; light only inside walls. | `[W-Getting_Started]`, `[W-Tips]` |
| Invasion or horde | Nightfall on the scheduled day | A title message and sound when a wave spawns. Waves about every 3,332 ticks. Beds disabled. Special mobs (Husk, Excavator, Giant) spawn about 200 blocks away. | Not expected on day 1 (see the schedule note). If one happens: stay sealed in, do not sleep, expect Excavators to destroy bases. | `[R:hordes.cfg]`, `[W-Invasions]`, `[W-Tips]` |
| Blood Moon | Rare night | Red moon (assumed); sleeping disabled | Same as an invasion. Do not try to sleep. | `[W-Tips]`, `[W-Bed]` |
| Harvester | Killing one sets the "killedHarvester" stage and guarantees a Harvest Moon the next night. Spawns only in dimension 0, natural spawn weight 0 `[R:config/harvestersnight.cfg]` | n/a early | Do not summon or fight bosses early. | `[R:scripts/stages.zs]` |
| AggroTP (Quazar) | A Quazar aggroes on you; `betterslimes:quazar` is the only mob configured | Position jumps of about 7 blocks every 21 to 29 s; only the aggroed player is teleported | A boss, irrelevant on day 1. Re-plan after any position jump of 5 or more blocks. | `[R:config/aggrotp.cfg]`, changelog 3.2.2 |
| Bandits in villages | Entering a village within about 1000 blocks of spawn | Armed bandits in the village | Avoid villages early. | `[W-Getting_Started]` |
| Sky bases | Building high | Some mobs spawn only at certain heights | Do not build up in the air. | `[W-Getting_Started]` |
| Hawthorn berries (`biomesoplenty:berries`) | Picking them | The thorns are poisonous `[HB newbeginning/getting_food_1]` | Do not pick them. Use Carminberries (`rustic:wildberries`) instead. | `[W-Getting_Started]`, `[HB newbeginning/getting_food_1]` |
| Cloudsbluff (`rustic:cloudsbluff`) | Eating it | Makes you float upward | Do not eat it. | `[HB newbeginning/getting_food_1]` |
| Falling trees | Chopping | Trees fall in the chop direction `[W-Tips]` | Chop from the side so you are out of the fall path. | `[W-Tips]` |
| Quicksand | Desert pools lined with sandstone | A fluid you cannot jump or swim in | Avoid desert pools. The escape method is not on the wiki. | `[W-Quicksand]` |
| Stymphalian birds, eels, lampreys | Swamps and bayous | Attacks over water | Avoid swamps while weak. | `[W-Early-Game_Base_Strategies]` |
| Wetas | Complete darkness in caves | Appear only in full darkness | Light caves before entering. | changelog 3.2.1 |
| Deep caves | Below Y 40 to 50 (Magma Grunts, Embers, Salamanders) | Mobs listed in the stage notes | Do not go deep before iron tools and a shield. | `[W-Progression_Stages]` |
| Beneath darkness | The Beneath dimension | Darkness damages you `[W-Tips]` | Not relevant before the Nether. | `[W-Tips]` |
| Blazes | Nether | Melee hit has a 15% chance of an effect that explodes after 8 s | Not early game. | changelog 3.2.2 |
| Death | Any lethal damage | Respawn after 7 s `[R:config/respawntimer.cfg]` | You keep main hand, off hand, armor and baubles; everything else drops where you died and does not despawn. Hunger resets to 13 or 14; 50% of XP is lost `[R:config/corpsecomplex.cfg]`. Go back to the death spot for the items. | `[R:config/corpsecomplex.cfg]`, `[HB survival/death]` |
| Sleeping | Using a bed | Needs a full hunger bar, a light source nearby, and no blood moon, invasion or thunderstorm | Do not plan on sleeping on day 1; there is no early-game bed recipe. | `[W-Bed]`, `[W-Tips]` |
| Dodging | Alt + direction | A dash that costs some hunger and depends on armor | Do not use it as a reflex. | `[HB newbeginning/new_world]` |

**The invasion schedule is inconsistent.** The wiki says "every 17 days" and `[W-Tips]` says "every 17 nights". `hordes.cfg` says every 15 days, with `spawnFirstDay=false`. The changelog says "Hordes are disabled on servers" as of 3.3. All of these agree that no invasion happens on days 0 to 14, so day 1 is safe either way. Whether hordes run on a live 3.3.2 server is UNVERIFIED. Treat any wail or title message as an invasion.

---

## 3. Safe first-day script (plain steps for skills-rotn)

Time budget: the day lasts about 20 real minutes `[W-Getting_Started]`. Do not rely on world time values (see the Extended Days warning). Do the steps in order, and check hunger and threats between steps.

1. **Settle in (about 1 min).** Read the inventory. Record the spawn coordinates. Do not eat unless hunger is low. Note the nearest trees, rocks and water.
2. **Collect rocks.** Gather about 12 rocks (`pyrotech:rock`) from surface piles near spawn, staying within about 100 blocks of it. Rocks are needed for: crude axe (1 each), Crafting Tools (1), pickaxe and axe (3 each), cobblestone (4 each).
3. **Collect sticks.** Break leaves until you have about 6 sticks. Break tall grass too if plant fibre drops.
4. **Craft 2 to 3 crude axes** in the 2x2 grid (1 rock + 2 sticks each). Each lasts only about 8 uses `[W-Tools]`.
5. **Fell one tree** and take the logs, staying out of the fall path. If the crude axe fails to fell it, stop and report this as a harness defect.
6. **Make the crafting table.** Place one log, right-click it with the crude axe to debark it, then right-click the debarked log for one plank. Craft Crafting Tools (crude axe + rock + stick). Craft the crafting table from one plank + Crafting Tools, and place it.
7. **Planks and sticks.** Put logs in the table for 3 planks each. Turn two planks into 4 sticks. Aim for about 8 planks and 8 sticks.
8. **Stone tools.** Craft one stone pickaxe and one stone axe (3 rocks + 2 sticks each, in the 3x3 table): 6 rocks and 4 sticks in total. Chop with the stone axe from now on.
9. **More rocks from stone.** With the stone pickaxe, mine stone for 4 rocks per block. Make cobblestone (4 rocks per block) for a shelter, plus 8 rocks for a furnace if wanted.
10. **Food.** Eat available berries (`rustic:wildberries`), ginseng (`rustic:ginseng`), marsh mallow (`rustic:marsh_mallow`) or fruit. Never pick hawthorn. Kill a passive animal if one is close. Keep the bread.
11. **Pick a shelter site 5 to 8 minutes before sunset.** Good sites: a hillside or cave opening, a tree, a ruin or an island. Avoid dirt shacks, villages and sky platforms.
12. **Build the shelter.** Enclose yourself completely in cobblestone or stone, with at least 2 blocks of headroom and no gaps. Use light only inside the walls, or none at all.
13. **Use the Scroll of New Life** inside the shelter so you respawn nearby (mechanic UNVERIFIED).
14. **Night routine.** Stay sealed in. If a mob breaks a wall, repair it, and fight only at the opening. Eat at hunger 12 or lower. If you need more stone, mine it from the inside. Do not leave until it is bright.
15. **Dawn.** Wait until daylight. Zombies and skeletons burn in sunlight `[R:hordes.cfg]`, but some mobs do not. Check the surroundings, then continue the agenda: coal, a pit kiln for charcoal, then iron.

**Next-day agenda (stone to iron).** Find coal and iron outcrops and mine them with the stone pickaxe, which is enough for level 0 ores. Smelt in the Pyrotech Stone Kiln, then craft iron tools. Keep the stone tools as backup.

---

## 4. Exact 1.12.2 item names

All of these appear in the 3.3.2 scripts and configs. The numeric metadata for `pyrotech:rock` and `pyrotech:material` is only partly known; rotn-data should dump the full table.

| Name | Registry id and meta | Source |
|---|---|---|
| Oak log / oak planks | `minecraft:log:0` / `minecraft:planks:0` | `[R:scripts/wood_stripping_boards.zs]` |
| Birch planks, acacia planks | `minecraft:planks:2`, `minecraft:planks:4` | same |
| Debarked oak log | `hitwithaxe:debarked_oak` (meta 0, 1, 2 = X, Y, Z) | same |
| Oak bark | `hitwithaxe:bark:15` | same |
| Stick, broken stick | `minecraft:stick`, `contenttweaker:broken_stick` | `[R:scripts/minecraft_(max-file-size).zs]` |
| Stone rock | `pyrotech:rock` (meta 0). Other known metas: 3 (zinc bits), 6 (sandstone), 7 (wood chips), 8 (limerock). Underground Biomes stone types use `pyrotech_compat:rock_igneous:N` etc. | `[R:scripts/stones_rocks_and_bricks.txt]`, anvil and kiln scripts |
| Cobblestone | `minecraft:cobblestone` | `[R:scripts/minecraft_(max-file-size).zs]` |
| Crude axe | `pyrotech:crude_axe` | `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]` |
| Crafting Tools | `contenttweaker:crafting_tools` | `[R:scripts/crafting_tables.zs]` |
| Crafting table | `minecraft:crafting_table` | same |
| Portable crafting mat | `craftingcraft:portable_crafting_table:0` | same |
| Stone tools | `minecraft:stone_pickaxe`, `minecraft:stone_axe` | `[R:scripts/recipe_cohesion.zs]` |
| Flint | `minecraft:flint` | `[R:scripts/minecraft_(max-file-size).zs]` |
| Furnace | `minecraft:furnace` | same |
| Charcoal | `minecraft:coal:1` | `[R:scripts/minecraft_(max-file-size).zs]` |
| Torch | `minecraft:torch` | `[HB newbeginning/fire_1]` |
| Tinder, twine | `pyrotech:tinder`; twine is oredict `twine` (item id not captured) | `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]` |
| Stone hammer | `pyrotech:stone_hammer` | `[R:scripts/minecraft_(max-file-size).zs]` |
| Iron sledgehammer | `pyrotech:iron_hammer` (renamed in-game) | `[R:scripts/pyrotech/pyrotech_recipes_craftingtable.zs]` |
| Raw ores | `contenttweaker:raw_iron`, `raw_copper`, `raw_tin`, `raw_silver`, `raw_gold` | `[HB newbeginning/spelunking]` |
| Iron ingot | `minecraft:iron_ingot` (oredict `ingotIron`) | kiln script |
| Foods | `rustic:wildberries`, `rustic:ginseng`, `rustic:marsh_mallow`, `rustic:core_root`, `rustic:cloudsbluff`, `biomesoplenty:berries` (hawthorn) | `[HB newbeginning/getting_food_1]` |
| Oredicts used | `rock`, `stickWood`, `stickMat`, `plankWood`, `genericMetalNuggets`, `rawOreIron`, `oreIron`, `gravel` | scripts above |

Registry ids for the Scroll of New Life, the Bundle and the Stone Kiln block are UNVERIFIED.

---

## A. Server pack download candidates (human to confirm)

- **Server pack (3.3.2).**
  - File name: `Rebirth of the Night 3.3.2 Server Pack.zip`.
  - CurseForge file ID: **7219650**.
  - File page: `https://www.curseforge.com/minecraft/modpacks/rebirth-of-the-night/files/7219650`.
  - Download link pattern: `https://www.curseforge.com/minecraft/modpacks/rebirth-of-the-night/download/7219650`.
  - Size 735.6 MB, uploaded 2025-11-14 by Foreck1, Forge 1.12.2, release type Release, description "Server files." `[CF]`.
- **Matching client pack.** `Rebirth of the Night (RotN) 3.3.2.zip`, file ID 7219585, about 1.0 GB `[CF]`.
- **Checksum.** CurseForge does not show SHA1 or MD5 on either file page. Use the CurseForge API's file hashes if a key is available; otherwise record our own SHA-256 on first download.
- **Newer files exist.** 3.3.3 (7543824), 3.3.4 (7564531) and the RotN 3.3.4 Server Pack (7564549) are out. Pin by file ID, not "latest".
- **Server files in the repo.** `_server-only/` holds `forge-1.12.2-14.23.5.2860.jar`, `minecraft_server.1.12.2.jar`, start scripts (`java -Xmx4096M -Xms256M -jar forge-1.12.2-14.23.5.2860.jar nogui`) and `server.properties`. That `server.properties` is dated 2021 and may not match the shipped zip: `online-mode=true`, `difficulty=2`, `white-list=false`, `view-distance=6`, `spawn-protection=0`, `pvp=true`, `level-type=BIOMESOP`.

---

## B. Forge version and mods

**Forge.** The server jar in the repo is `forge-1.12.2-14.23.5.2860` (lead-verified). The wiki's front page lists 14.23.5.2859 for the client. Both are 14.23.5.x for 1.12.2; the one-build mismatch is minor but worth noting.

**Java.** Java 8 only `[W-Installation]`. Recommended RAM is about 6 GB for the client; the pack's start script gives the server 4 GB, enough for 4 to 5 players.

**Mods confirmed by config or script at 3.3.2.** The 2.77.5 list on `[W-Mod_List]` is outdated; 3.2.0 replaced several mods. This list comes from `config/`, `scripts/` and the changelog.

- **Early-game mechanics.**
  - Pyrotech (rocks, crude axe, kilns, tinder); `pyrotech_compat` adds rocks for Underground Biomes stone types.
  - Hit With Axe: `hitwithaxe.cfg` sets Food Cost 0 and Swing Cooldown 2 ticks.
  - Dynamic Trees fork (changelog: "Dramatic Trees").
  - Tool Progression (mining-level names) and Quality Tools.
  - Game Stages, Recipe Stages and Mob Stages (via CraftTweaker scripts).
  - ContentTweaker (provides the `contenttweaker:` items).
- **Survival and death.**
  - Hardcore Darkness (`hardcoredarkness.cfg`).
  - The Hordes (`hordes.cfg`), replacing Onslaught.
  - Harvester's Night (`harvestersnight.cfg`).
  - AggroTP (`aggrotp.cfg`, Quazar only).
  - Corpse Complex (`corpsecomplex.cfg`).
  - Life Scroll, Respawn Timer, Let Me Sleep.
  - Hunger Overhaul (config folder), Spice of Life Carrot Edition (`solcarrot.cfg`), AppleSkin.
  - Serene Seasons (9-day seasons `[W-Tips]`).
  - Zombie Awareness, Rough Mobs Revamped, Special Mobs, Special AI, Zombie Players, Primitive Mobs, Rats, Mowzie's Mobs, Better Animals Plus.
  - Server-only: Morpheus, TimeShallNotPass, Advanced MOTD, Chunk Gen Limiter, Dynamic View Distance. TimeShallNotPass stops time while no players are online (matches changelog 3.2.1b).
- **Protocol-relevant (for net-forge).**
  - **RoughlyEnoughIDs** (`config/RoughlyEnoughIDs.cfg`, lead-verified present) extends block and biome id ranges. This probably changes the chunk packet format. Check handshake and chunk decoding early.
  - Just Enough Dimensions (`justenoughdimensions/justenoughdimensions.cfg`) and Biome Tweaker.
  - Extra dimensions: The Aether Legacy, Twilight Forest, The Beneath, End Reborn, NetherEx, Better Nether.
  - Dimension 7 appears in the Pyrotech worldgen config, and "Unloading dimension 7" is the server's ready message at startup `[R:_server-only/READ ME!!!!!!.txt]`. Which dimension id the bot spawns in is UNVERIFIED; read it from the JoinGame packet at login.
- **Not found in the configs.** Tough As Nails or any thirst or temperature mod (no `toughasnails` config), Epic Siege Mod, Hostile Worlds. A mod without a config file would not show up here, so absence is not proof.
- **Thirst.** `thirsty-bottles.cfg` exists but was not opened. Whether it adds thirst is UNVERIFIED.

---

## C. Harvest levels in the early game

- **Level names and numbers** (`[R:config/tool_progression/mining_level_names.cfg]`): 0 Crude, 1 Sturdy, 2 Refined, 3 Masterwork, 4 Mythical, 5 Exotic, 6 Zenith. `[W-Tools]` adds a "None" tier for bare hands.
- **Crude axe.** Level Crude, durability 8, speed 2 `[W-Tools]`.
- **Stone pickaxe, axe, shovel.** Level Crude, durability 131, speed 4 `[W-Tools]`.
- **Iron and bronze tools.** Level Sturdy.
- **Ore requirements** (`[R:config/tool_progression/block_overwrites.cfg]`):
  - Coal, iron, tin, copper (and dense variants): pickaxe level 0, so a stone pickaxe is enough.
  - Redstone, lapis, gold, silver, emerald, gravitite: level 1.
  - Diamond, peridot, ruby, sapphire, zanite, cincinnasite: level 2.
  - Mythril, viridium: level 3.
  - Sturdy Cobblestone block: pickaxe level 1 `[W-Block_Harvestability]` (page last edited 2020).
- **Stone.** A pickaxe below Sturdy turns stone into 4 rocks; Sturdy or better drops cobblestone `[W-Stone]`, `[W-Getting_Started]`.
- **Logs.** The wiki says a crude axe is required to harvest trees. `block_overwrites` has no entry for vanilla logs, and no other config forces axes, so the requirement probably comes from Dynamic Trees and Hit With Axe, which were not read. UNVERIFIED.
- **Pyrotech native tools.** `module.Tool.cfg` gives Crude tools durability 8 and harvest level 0, and flint tools durability 150 and level 1. Whether flint pickaxes exist in 3.3.2 is UNVERIFIED; no recipe was found.
- **Leaves.** `?hoe=0` (hoe optional) `[R:config/tool_progression/block_overwrites.cfg]`; the wiki says to get sticks by breaking leaves.

---

## Open items to verify in the harness (first scenario)

1. Does punching a log drop anything? The wiki says no; the handbook and `[W-Tips]` say yes.
2. Does the Crafting Tools recipe consume the crude axe?
3. How many planks does one right-click on a debarked log give?
4. Does the log-to-3-planks recipe work in the 2x2 inventory grid?
5. What does an ore block drop, and does the plain furnace smelt `contenttweaker:raw_iron`?
6. Registry ids of the Scroll of New Life, Bundle and Stone Kiln; the full `pyrotech:rock` metadata table.
7. Which dimension id the bot joins, and whether hordes run on the live server.
8. Does Extended Days change the time packet, and how should the bot detect sunset?

**Source URLs.** Wiki: https://rotn.wiki.gg/wiki/Getting_Started, /Tools, /Stone, /Tips, /Invasions, /Hunger, /Bed, /Zombie, /Kiln, /Changelog, /Progression_Stages, /Installation, /Mod_List, /Crafting_Table, /Quicksand, /Early-Game_Base_Strategies, /Block_Harvestability. CurseForge: https://www.curseforge.com/minecraft/modpacks/rebirth-of-the-night/files/7219650, /files/7219585 and /files/all. Repo: https://github.com/Rebirth-of-the-Night/Rebirth-of-the-Night/tree/bd2d078d933e798ad9f87d3171ca31ddbe6b24f4.
