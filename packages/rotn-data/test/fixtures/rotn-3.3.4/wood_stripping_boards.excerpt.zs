# Excerpt of scripts/wood_stripping_boards.zs from the pinned RotN 3.3.4 server pack (zip SHA-256 90642fd5...f5205);
# file SHA-256 27f07a694528d8629f2ea61595cf2405f24882228dabcb705e08ba20cd25a12b. Each line is "<line number>: <text>" (CRLF dropped).
# The lines cited by packages/rotn-data/3.3.4/world-sources.json: 11-29 (oak planks crafting, debark, plank), 90-93 (spruce),
# 777-793 (debarked dead log and planks -> 2 sticks). Read by test/howto.test.js.
10: recipes.removeByRecipeName("minecraft:oak_planks");
11: recipes.addShaped("oak_planks", <minecraft:planks>*3,[
12: 	[null],
13: 	[<minecraft:log>],
14: 	[null]
15: ]);
16: recipes.addHiddenShaped("oak_planks1", <minecraft:planks>*3,[
17: 	[<minecraft:log>],
18: 	[null],
19: 	[null]
20: ]);
21: recipes.addHiddenShaped("oak_planks2", <minecraft:planks>*3,[
22: 	[null],
23: 	[null],
24: 	[<minecraft:log>]
25: ]);
26: Chopping.addRecipe("minecraft:log", 0, "hitwithaxe:debarked_oak", 1, <hitwithaxe:bark:15>); //Y Axis
27: Chopping.addRecipe("minecraft:log", 4, "hitwithaxe:debarked_oak", 0, <hitwithaxe:bark:15>); //X Axis
28: Chopping.addRecipe("minecraft:log", 8, "hitwithaxe:debarked_oak", 2, <hitwithaxe:bark:15>); //Z Axis
29: Chopping.addRecipe("hitwithaxe:debarked_oak", 32767, <minecraft:planks>);
90: Chopping.addRecipe("minecraft:log", 1, "hitwithaxe:debarked_spruce", 1, <hitwithaxe:bark:20>); //Y Axis
91: Chopping.addRecipe("minecraft:log", 5, "hitwithaxe:debarked_spruce", 0, <hitwithaxe:bark:20>); //X Axis
92: Chopping.addRecipe("minecraft:log", 9, "hitwithaxe:debarked_spruce", 2, <hitwithaxe:bark:20>); //Z Axis
93: Chopping.addRecipe("hitwithaxe:debarked_spruce", 32767, <minecraft:planks:1>);
777: Chopping.addRecipe("hitwithaxe:debarked_dead", 32767, <minecraft:stick> * 2);
778: //Plank -> Stick
779: Chopping.addRecipe("minecraft:planks", 32767, <minecraft:stick> * 2);
780: Chopping.addRecipe("plants2:planks", 32767, <minecraft:stick> * 2);
781: Chopping.addRecipe("plants2:crystal_planks", 32767, <minecraft:stick> * 2);
782: Chopping.addRecipe("integrateddynamics:menril_planks", 32767, <minecraft:stick> * 2);
783: Chopping.addRecipe("thaumcraft:plank_silverwood", 32767, <minecraft:stick> * 2);
784: Chopping.addRecipe("thaumcraft:plank_greatwood", 32767, <minecraft:stick> * 2);
785: Chopping.addRecipe("thebetweenlands:weedwood_planks", 32767, <minecraft:stick> * 2);
786: Chopping.addRecipe("thebetweenlands:rubber_tree_planks", 32767, <minecraft:stick> * 2);
787: Chopping.addRecipe("thebetweenlands:giant_root_planks", 32767, <minecraft:stick> * 2);
788: Chopping.addRecipe("traverse:fir_planks", 32767, <minecraft:stick> * 2);
789: Chopping.addRecipe("randomthings:spectreplank", 32767, <minecraft:stick> * 2);
790: Chopping.addRecipe("natura:overworld_planks", 32767, <minecraft:stick> * 2);
791: Chopping.addRecipe("rustic:planks", 32767, <minecraft:stick> * 2);
792: Chopping.addRecipe("naturesaura:ancient_planks", 32767, <minecraft:stick> * 2);
793: Chopping.addRecipe("biomesoplenty:planks_0", 32767, <minecraft:stick> * 2);
