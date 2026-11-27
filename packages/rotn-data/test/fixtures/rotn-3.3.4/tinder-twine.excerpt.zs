# Excerpts of RotN 3.3.4 server pack scripts (pinned zip SHA-256 90642fd5...f5205), the lines cited by packages/rotn-data/3.3.4/world-sources.json
# rule grass-tinder: how tinder (pyrotech:tinder) is and is not made, twine and the handle. Each line is "<line number>: <text>" (CRLF dropped).
# Read by test/grass-tinder.test.js. The grass drop odds are in fixtures/forage-food-3.3.4/dropt.zs (the whole file).
## scripts/pyrotech/pyrotech_recipes_craftingtable.zs (file SHA-256 bc86aa197c45e6195306f071d61c35cbc9a3a15b65a592aa307e55511bc647f4)
41: recipes.remove(<pyrotech:tinder>);
113: val dry = <pyrotech:tinder>;
114: val twine = <pyrotech:material:14>;
130: recipes.addShaped("dry_to_twine", twine*3,
131: [[dry,dry,dry]]);
## scripts/spartan.zs (file SHA-256 7a5601ac5cf906d27d91c4ec0b4dd2639b7c1c089e2d3cf6e76047e0a4326e07)
175: recipes.addShapeless("string_twine_handle",<spartanweaponry:material:0>,[<ore:stickWood>,<minecraft:string>|<pyrotech:material:14>]);
## scripts/pyrotech/pyrotech_recipes_other.zs (file SHA-256 84e75e69b2350c4405ee816f3ec66bab1cbe048798baa76670dab7041b42efbc)
206: CrudeDryingRack.removeRecipes(<pyrotech:material:2>);
207: CrudeDryingRack.removeRecipes(<pyrotech:material:13>);
208: DryingRack.removeRecipes(<pyrotech:material:2>);
209: DryingRack.removeRecipes(<pyrotech:material:13>);
219: CrudeDryingRack.addRecipe("dried_fiber_fresh", <pyrotech:tinder>, <pyrotech:material:12>, 5 * 60 * 20, true);
220: CrudeDryingRack.addRecipe("dried_fiber_sapling", <pyrotech:tinder>, <ore:treeSapling>, 5 * 60 * 20, true);
## scripts/jei_descriptions.zs (file SHA-256 c9a76a794b8b915c4bbb9935b71856109db977abfb640ce73eab06c7841f712a)
221: val plantFiber = <pyrotech:material:12>;
222: val driedPlantFiber = <pyrotech:tinder>;
223: val twine = <pyrotech:material:14>;
