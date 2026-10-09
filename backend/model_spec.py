from pathlib import Path
import os
MODEL_ID = "fruit-veg-36"
REPOSITORY = "jazzmacedo/fruits-and-vegetables-detector-36"
REVISION = "a84824cd6c10eed4defb83d373b4377c85c1cf73"
MODEL_DIR = Path(os.environ.get("VISION_MODEL_DIR", Path(__file__).parent / "models" / MODEL_ID))
LABELS_ZH = {
 "apple":"苹果", "banana":"香蕉", "beetroot":"甜菜根", "bell pepper":"甜椒", "cabbage":"卷心菜", "capsicum":"青椒",
 "carrot":"胡萝卜", "cauliflower":"花椰菜", "chilli pepper":"辣椒", "corn":"玉米", "cucumber":"黄瓜", "eggplant":"茄子",
 "garlic":"大蒜", "ginger":"生姜", "grapes":"葡萄", "jalepeno":"墨西哥辣椒", "kiwi":"猕猴桃", "lemon":"柠檬",
 "lettuce":"生菜", "mango":"芒果", "onion":"洋葱", "orange":"橙子", "paprika":"红甜椒", "pear":"梨", "peas":"豌豆",
 "pineapple":"菠萝", "pomegranate":"石榴", "potato":"土豆", "raddish":"萝卜", "soy beans":"大豆", "spinach":"菠菜",
 "sweetcorn":"甜玉米", "sweetpotato":"红薯", "tomato":"番茄", "turnip":"芜菁", "watermelon":"西瓜"
}
