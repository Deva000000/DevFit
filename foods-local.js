/* DevFit curated food database — offline, Malaysia-first.
   Always available (no API, no rate limit, works offline) and ranked above
   USDA / Open Food Facts so local + staple foods surface first.
   Values are per 100 g (or per 100 ml for drinks); `serving` = a typical
   single serving in grams/ml, used to pre-fill the amount picker.
   Sources: published nutrition tables + brand labels (approximate, good
   enough for daily tracking). Edit with the Edit tool only (UTF-8). */
(function(){
  // {name, serving, cal, p, c, f, tags?}  — cal/p/c/f are PER 100g
  const F = [
    // ── Malaysian / SE-Asian rice & noodle mains ──
    {name:'Nasi Lemak (with sambal, egg, anchovies)', serving:250, cal:200, p:5, c:28, f:8, tags:'malaysian breakfast rice coconut'},
    {name:'Nasi Goreng (fried rice)', serving:300, cal:165, p:6, c:24, f:5, tags:'malaysian fried rice goreng'},
    {name:'Nasi Putih (steamed white rice)', serving:150, cal:130, p:2.7, c:28, f:0.3, tags:'malaysian plain rice'},
    {name:'Nasi Briyani', serving:350, cal:180, p:7, c:26, f:6, tags:'indian rice biryani'},
    {name:'Nasi Kandar (rice with curries)', serving:400, cal:185, p:8, c:24, f:6, tags:'mamak rice curry'},
    {name:'Nasi Campur (mixed economy rice)', serving:350, cal:175, p:8, c:23, f:6, tags:'economy mixed rice'},
    {name:'Nasi Dagang', serving:250, cal:220, p:6, c:30, f:9, tags:'terengganu rice'},
    {name:'Char Kuey Teow', serving:300, cal:190, p:8, c:22, f:8, tags:'penang fried flat noodle ckt'},
    {name:'Mee Goreng', serving:300, cal:180, p:7, c:25, f:6, tags:'fried noodle mamak'},
    {name:'Maggi Goreng', serving:280, cal:200, p:6, c:26, f:8, tags:'fried instant noodle mamak'},
    {name:'Hokkien Mee (KL dark)', serving:350, cal:150, p:7, c:18, f:6, tags:'fried noodle'},
    {name:'Wantan Mee', serving:300, cal:160, p:8, c:24, f:4, tags:'noodle char siew'},
    {name:'Curry Mee / Curry Laksa', serving:450, cal:120, p:5, c:13, f:6, tags:'noodle curry soup laksa'},
    {name:'Asam Laksa', serving:500, cal:85, p:4, c:13, f:2, tags:'penang sour fish noodle'},
    {name:'Laksa (coconut curry)', serving:500, cal:110, p:5, c:12, f:5, tags:'noodle soup'},
    {name:'Mee Rebus', serving:400, cal:110, p:4, c:16, f:3, tags:'noodle gravy'},
    {name:'Mee Soto', serving:400, cal:90, p:5, c:12, f:2, tags:'noodle soup chicken'},
    {name:'Lontong', serving:350, cal:110, p:3, c:14, f:5, tags:'rice cake vegetable curry'},
    {name:'Bak Kut Teh', serving:400, cal:120, p:12, c:2, f:7, tags:'pork herbal soup'},
    {name:'Hainanese Chicken Rice (with rice)', serving:350, cal:190, p:10, c:22, f:7, tags:'chicken rice'},
    {name:'Chicken Chop', serving:250, cal:180, p:14, c:10, f:9, tags:'western chicken'},

    // ── Roti / bread / Indian ──
    {name:'Roti Canai (plain)', serving:90, cal:300, p:6, c:40, f:13, tags:'mamak bread flatbread'},
    {name:'Roti Telur (egg)', serving:120, cal:290, p:8, c:36, f:13, tags:'mamak bread egg'},
    {name:'Roti Tisu', serving:80, cal:380, p:6, c:55, f:15, tags:'mamak bread sweet'},
    {name:'Thosai / Tosai (plain)', serving:100, cal:170, p:4, c:30, f:3, tags:'indian dosa'},
    {name:'Idli', serving:80, cal:130, p:4, c:26, f:0.5, tags:'indian steamed'},
    {name:'Chapati', serving:60, cal:300, p:9, c:46, f:7, tags:'indian flatbread'},
    {name:'Naan', serving:90, cal:310, p:9, c:50, f:8, tags:'indian bread'},
    {name:'Capati / Roti with Dhal', serving:200, cal:170, p:7, c:25, f:5, tags:'indian'},
    {name:'Murtabak', serving:150, cal:250, p:10, c:25, f:12, tags:'mamak stuffed bread'},
    {name:'Kaya Toast (2 slices, kaya & butter)', serving:80, cal:320, p:6, c:40, f:15, tags:'breakfast roti bakar'},
    {name:'Half-boiled Eggs (2)', serving:100, cal:155, p:13, c:1.1, f:11, tags:'breakfast soft egg'},

    // ── Meats / protein dishes ──
    {name:'Satay Chicken (per stick ~15g)', serving:60, cal:250, p:20, c:6, f:16, tags:'grilled skewer'},
    {name:'Beef Rendang', serving:120, cal:200, p:15, c:6, f:13, tags:'malaysian curry beef'},
    {name:'Ayam Goreng (fried chicken)', serving:120, cal:250, p:22, c:8, f:14, tags:'fried chicken'},
    {name:'Ayam Masak Merah', serving:150, cal:170, p:16, c:7, f:9, tags:'chicken tomato'},
    {name:'Curry Chicken', serving:150, cal:160, p:15, c:5, f:9, tags:'kari ayam'},
    {name:'Tandoori Chicken', serving:150, cal:215, p:27, c:2, f:11, tags:'indian grilled'},
    {name:'Char Siew (BBQ pork)', serving:100, cal:240, p:20, c:12, f:12, tags:'roast pork'},
    {name:'Roast Duck', serving:120, cal:240, p:19, c:0, f:18, tags:'siew ngap'},
    {name:'Otak-otak', serving:50, cal:150, p:10, c:6, f:9, tags:'grilled fish cake'},
    {name:'Ikan Bakar (grilled fish)', serving:150, cal:130, p:22, c:1, f:4, tags:'grilled fish'},
    {name:'Sambal Sotong (squid)', serving:120, cal:130, p:14, c:6, f:6, tags:'spicy squid'},

    // ── Snacks / kuih / sides ──
    {name:'Curry Puff (Karipap)', serving:60, cal:300, p:6, c:35, f:15, tags:'snack pastry'},
    {name:'Popiah', serving:120, cal:150, p:4, c:22, f:5, tags:'spring roll'},
    {name:'Pisang Goreng (banana fritter)', serving:100, cal:270, p:3, c:40, f:11, tags:'fried banana snack'},
    {name:'Keropok Lekor', serving:80, cal:250, p:8, c:35, f:8, tags:'fish cracker'},
    {name:'Apam Balik', serving:100, cal:320, p:6, c:45, f:13, tags:'peanut pancake'},
    {name:'Kuih (assorted)', serving:50, cal:250, p:3, c:40, f:9, tags:'malay dessert cake'},
    {name:'Rojak (fruit & veg)', serving:200, cal:120, p:3, c:20, f:3, tags:'salad shrimp paste'},
    {name:'Dim Sum Siew Mai (per pc)', serving:80, cal:210, p:12, c:18, f:10, tags:'pork dumpling'},
    {name:'Wantan / Dumpling Soup', serving:300, cal:80, p:5, c:9, f:2, tags:'soup'},
    {name:'Spring Roll (fried)', serving:60, cal:280, p:5, c:30, f:15, tags:'snack'},

    // ── Desserts / sweet ──
    {name:'Cendol', serving:250, cal:140, p:1, c:24, f:5, tags:'dessert coconut'},
    {name:'Ais Kacang / ABC', serving:300, cal:120, p:2, c:26, f:2, tags:'dessert shaved ice'},
    {name:'Bubur Cha Cha', serving:250, cal:150, p:2, c:25, f:5, tags:'dessert coconut'},

    // ── Drinks (per 100 ml) ──
    {name:'Teh Tarik', serving:200, cal:90, p:2, c:12, f:4, tags:'drink tea milk'},
    {name:'Kopi (with condensed milk)', serving:200, cal:70, p:1, c:12, f:2, tags:'drink coffee'},
    {name:'Kopi O (black, sugar)', serving:200, cal:25, p:0, c:6, f:0, tags:'drink coffee black'},
    {name:'Milo Ais', serving:250, cal:80, p:2, c:14, f:2, tags:'drink chocolate malt'},
    {name:'Sirap Bandung', serving:250, cal:90, p:1, c:18, f:2, tags:'drink rose milk'},
    {name:'Limau Ais (lime)', serving:250, cal:35, p:0, c:9, f:0, tags:'drink lime'},
    {name:'100 Plus', brand:'F&N', serving:325, cal:26, p:0, c:6.5, f:0, tags:'drink isotonic soda'},
    {name:'Coca-Cola', brand:'Coca-Cola', serving:330, cal:42, p:0, c:10.6, f:0, tags:'drink soda'},
    {name:'Orange Juice', serving:250, cal:45, p:0.7, c:10, f:0.2, tags:'drink fruit'},
    {name:'Coconut Water', serving:250, cal:19, p:0.7, c:3.7, f:0.2, tags:'drink'},
    {name:'Black Coffee (no sugar)', serving:240, cal:1, p:0.1, c:0, f:0, tags:'drink coffee'},

    // ── Global staples: grains & carbs ──
    {name:'White Rice (cooked)', serving:150, cal:130, p:2.7, c:28, f:0.3, tags:'staple grain'},
    {name:'Brown Rice (cooked)', serving:150, cal:123, p:2.7, c:26, f:1, tags:'staple grain'},
    {name:'Oats (rolled, dry)', serving:40, cal:389, p:17, c:66, f:7, tags:'oatmeal breakfast'},
    {name:'Oatmeal (cooked with water)', serving:240, cal:71, p:2.5, c:12, f:1.5, tags:'porridge breakfast'},
    {name:'Pasta (cooked)', serving:200, cal:158, p:6, c:31, f:0.9, tags:'spaghetti staple'},
    {name:'White Bread (1 slice)', serving:30, cal:265, p:9, c:49, f:3.2, tags:'staple loaf'},
    {name:'Wholemeal Bread (1 slice)', serving:30, cal:247, p:13, c:41, f:4.2, tags:'staple loaf'},
    {name:'Instant Noodles (cooked)', serving:300, cal:140, p:3, c:20, f:5, tags:'maggi ramen'},
    {name:'Instant Noodles (dry block)', serving:80, cal:450, p:10, c:60, f:18, tags:'maggi ramen'},
    {name:'Potato (boiled)', serving:150, cal:87, p:1.9, c:20, f:0.1, tags:'vegetable carb'},
    {name:'Sweet Potato (boiled)', serving:150, cal:86, p:1.6, c:20, f:0.1, tags:'vegetable carb'},
    {name:'French Fries', serving:120, cal:312, p:3.4, c:41, f:15, tags:'fast food fried'},

    // ── Protein ──
    {name:'Chicken Breast (cooked)', serving:120, cal:165, p:31, c:0, f:3.6, tags:'poultry lean protein'},
    {name:'Chicken Thigh (cooked)', serving:120, cal:209, p:26, c:0, f:11, tags:'poultry protein'},
    {name:'Egg (whole, 1)', serving:50, cal:155, p:13, c:1.1, f:11, tags:'protein breakfast'},
    {name:'Egg White', serving:33, cal:52, p:11, c:0.7, f:0.2, tags:'protein'},
    {name:'Beef (lean, cooked)', serving:120, cal:250, p:26, c:0, f:15, tags:'red meat protein'},
    {name:'Pork (lean, cooked)', serving:120, cal:242, p:27, c:0, f:14, tags:'meat protein'},
    {name:'Salmon (cooked)', serving:120, cal:208, p:20, c:0, f:13, tags:'fish omega protein'},
    {name:'Tuna (canned in water)', serving:100, cal:116, p:26, c:0, f:1, tags:'fish protein'},
    {name:'White Fish (cooked)', serving:120, cal:105, p:23, c:0, f:1.5, tags:'fish protein'},
    {name:'Prawns (cooked)', serving:100, cal:99, p:24, c:0, f:0.3, tags:'seafood protein'},
    {name:'Tofu (firm)', serving:120, cal:144, p:15, c:3, f:8, tags:'soy vegetarian protein'},
    {name:'Tempeh', serving:100, cal:192, p:20, c:8, f:11, tags:'soy vegetarian protein'},
    {name:'Whey Protein (1 scoop)', serving:30, cal:380, p:80, c:8, f:6, tags:'supplement shake protein'},

    // ── Dairy ──
    {name:'Whole Milk', serving:250, cal:61, p:3.2, c:4.8, f:3.3, tags:'dairy drink'},
    {name:'Skim Milk', serving:250, cal:34, p:3.4, c:5, f:0.1, tags:'dairy drink'},
    {name:'Greek Yogurt (plain)', serving:170, cal:59, p:10, c:3.6, f:0.4, tags:'dairy protein'},
    {name:'Cheddar Cheese', serving:30, cal:402, p:25, c:1.3, f:33, tags:'dairy'},
    {name:'Butter', serving:14, cal:717, p:0.9, c:0.1, f:81, tags:'dairy fat'},

    // ── Fruits ──
    {name:'Banana', serving:120, cal:89, p:1.1, c:23, f:0.3, tags:'fruit'},
    {name:'Apple', serving:180, cal:52, p:0.3, c:14, f:0.2, tags:'fruit'},
    {name:'Orange', serving:130, cal:47, p:0.9, c:12, f:0.1, tags:'fruit'},
    {name:'Watermelon', serving:150, cal:30, p:0.6, c:8, f:0.2, tags:'fruit'},
    {name:'Papaya', serving:150, cal:43, p:0.5, c:11, f:0.3, tags:'fruit'},
    {name:'Mango', serving:150, cal:60, p:0.8, c:15, f:0.4, tags:'fruit'},
    {name:'Pineapple', serving:150, cal:50, p:0.5, c:13, f:0.1, tags:'fruit'},
    {name:'Grapes', serving:100, cal:69, p:0.7, c:18, f:0.2, tags:'fruit'},
    {name:'Durian', serving:150, cal:147, p:1.5, c:27, f:5, tags:'fruit malaysian'},
    {name:'Guava', serving:150, cal:68, p:2.6, c:14, f:1, tags:'fruit jambu'},

    // ── Vegetables ──
    {name:'Broccoli', serving:100, cal:34, p:2.8, c:7, f:0.4, tags:'vegetable green'},
    {name:'Spinach', serving:100, cal:23, p:2.9, c:3.6, f:0.4, tags:'vegetable green bayam'},
    {name:'Kangkung (water spinach)', serving:100, cal:19, p:2.6, c:3, f:0.2, tags:'vegetable green'},
    {name:'Long Beans', serving:100, cal:47, p:3, c:8, f:0.4, tags:'vegetable kacang panjang'},
    {name:'Carrot', serving:80, cal:41, p:0.9, c:10, f:0.2, tags:'vegetable'},
    {name:'Cucumber', serving:100, cal:15, p:0.7, c:3.6, f:0.1, tags:'vegetable timun'},
    {name:'Tomato', serving:100, cal:18, p:0.9, c:3.9, f:0.2, tags:'vegetable'},
    {name:'Cabbage', serving:100, cal:25, p:1.3, c:6, f:0.1, tags:'vegetable'},
    {name:'Corn', serving:100, cal:86, p:3.2, c:19, f:1.2, tags:'vegetable jagung'},
    {name:'Mushroom', serving:100, cal:22, p:3.1, c:3.3, f:0.3, tags:'vegetable cendawan'},

    // ── Fats / nuts / condiments ──
    {name:'Peanut Butter', serving:32, cal:588, p:25, c:20, f:50, tags:'spread nut fat'},
    {name:'Almonds', serving:28, cal:579, p:21, c:22, f:50, tags:'nut snack'},
    {name:'Avocado', serving:100, cal:160, p:2, c:9, f:15, tags:'fruit fat'},
    {name:'Olive Oil', serving:14, cal:884, p:0, c:0, f:100, tags:'oil fat cooking'},
    {name:'Cooking Oil (vegetable)', serving:14, cal:884, p:0, c:0, f:100, tags:'oil fat'},
    {name:'Sambal Belacan', serving:30, cal:150, p:3, c:12, f:10, tags:'condiment chili'},
    {name:'Soy Sauce', serving:15, cal:53, p:8, c:5, f:0, tags:'condiment kicap'},
    {name:'Sugar (white)', serving:4, cal:387, p:0, c:100, f:0, tags:'sweetener'},
    {name:'Honey', serving:21, cal:304, p:0.3, c:82, f:0, tags:'sweetener'},

    // ── Treats / fast food ──
    {name:'Pizza (1 slice)', serving:100, cal:266, p:11, c:33, f:10, tags:'fast food'},
    {name:'Beef Burger (fast food)', serving:150, cal:250, p:13, c:30, f:9, tags:'fast food mcdonald'},
    {name:'Fried Chicken (KFC-style, 1 pc)', serving:120, cal:260, p:20, c:9, f:16, tags:'fast food kfc'},
    {name:'Dark Chocolate', serving:30, cal:546, p:5, c:61, f:31, tags:'snack sweet'},
    {name:'Milk Chocolate', serving:30, cal:535, p:7.6, c:59, f:30, tags:'snack sweet'},
    {name:'Ice Cream (vanilla)', serving:100, cal:207, p:3.5, c:24, f:11, tags:'dessert'},
    {name:'Potato Chips', serving:30, cal:536, p:7, c:53, f:34, tags:'snack crisps'},
    {name:'Biscuits (digestive)', serving:30, cal:480, p:7, c:62, f:21, tags:'snack cookie'}
  ];

  window.DEVFIT_LOCAL_FOODS = F;
})();
