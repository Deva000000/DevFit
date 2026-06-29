/* DevFit — Malaysia & Asia bulk food database (lazy-loaded).
   Appends to DEVFIT_LOCAL_FOODS already defined by foods-local.js.
   All nutrition values per 100 g; serving = default portion in grams.
   Sources: MyFCD (Malaysia Food Composition Database), HPB Singapore,
            USDA FoodData Central, brand label data. */
(function () {
  const F = window.DEVFIT_LOCAL_FOODS;
  if (!Array.isArray(F)) return;

  // a(name, servingG, cal/100g, p/100g, c/100g, f/100g, tags, brand)
  const a = (n, sv, cal, p, c, f, tg, br) => F.push({
    name: n, serving: sv, cal, p, c, f,
    tags: tg || '', brand: br || '',
    servings: [{ n: '100g', g: 100 }, ...(sv !== 100 ? [{ n: sv + 'g', g: sv }] : [])]
  });

  // ── ASIAN / MALAYSIAN VEGETABLES ─────────────────────────────────────
  a('Pak Choy / Bok Choy (raw)', 100, 13, 1.5, 2.2, 0.2, 'pak choy bok choy bayam cina sayur hijau vegetable');
  a('Pak Choy / Bok Choy (cooked)', 100, 12, 1.4, 1.9, 0.2, 'pak choy bok choy bayam cina sayur masak cooked stir-fry');
  a('Choy Sum / Sawi (raw)', 100, 20, 2.1, 3.3, 0.3, 'choy sum sawi cai xin sayur hijau vegetable stir fry');
  a('Choy Sum / Sawi (cooked)', 100, 17, 1.8, 2.8, 0.3, 'choy sum sawi masak cooked');
  a('Kai Lan / Kailan (stir-fried)', 130, 40, 2.8, 4.1, 1.8, 'kai lan kailan chinese broccoli gai lan stir fry oyster sauce vegetable');
  a('Bitter Gourd / Peria (raw)', 100, 17, 1, 3.3, 0.2, 'peria bitter gourd pare katak vegetable pahit');
  a('Bitter Gourd / Peria (cooked)', 100, 25, 1.2, 5.1, 0.3, 'peria bitter gourd masak cooked');
  a('Winter Melon / Labu Air (cooked)', 100, 13, 0.4, 3, 0.2, 'labu air winter melon wax gourd dong gua soup sayur');
  a('Bamboo Shoots / Rebung (cooked)', 100, 27, 2.6, 5.2, 0.3, 'rebung bamboo shoots masak cooked');
  a('Lotus Root / Akar Teratai (cooked)', 100, 74, 2.6, 16.4, 0.1, 'lotus root akar teratai lian ou soup stew');
  a('Jicama / Sengkuang (raw)', 100, 38, 0.7, 8.8, 0.1, 'sengkuang jicama yam bean lobak bangkuang raw salad pasembur');
  a('Spring Onion / Daun Bawang (raw)', 20, 32, 1.8, 7.3, 0.2, 'daun bawang spring onion scallion green onion garnish');
  a('Ginger / Halia (fresh)', 10, 80, 1.8, 17.8, 0.8, 'halia ginger fresh raw masak cooking spice');
  a('Shallots / Bawang Merah (raw)', 30, 72, 2.5, 16.8, 0.1, 'bawang merah shallot red onion raw masak');
  a('Garlic / Bawang Putih (raw)', 10, 149, 6.4, 33.1, 0.5, 'bawang putih garlic raw masak cooking clove ajo');
  a('Pumpkin / Labu Kuning (cooked)', 120, 26, 1, 6, 0.1, 'labu kuning pumpkin masak cooked soup curry');
  a('Yam / Keladi (cooked)', 130, 118, 1.5, 27.9, 0.1, 'keladi yam taro boiled cooked');
  a('Fresh Red Chilli / Cili Merah', 20, 40, 1.9, 8.8, 0.4, 'cili merah red chilli capsicum fresh raw hot spicy');
  a('Fresh Green Chilli / Cili Hijau', 20, 27, 1.3, 6, 0.3, 'cili hijau green chilli fresh raw hot spicy');
  a('Red Bell Pepper / Capsicum Merah', 100, 31, 1, 6, 0.3, 'capsicum pepper bell pepper paprika merah raw salad');
  a('Yellow Bell Pepper / Capsicum Kuning', 100, 27, 1, 6.3, 0.2, 'capsicum pepper bell pepper kuning yellow raw salad');
  a('Green Bell Pepper / Capsicum Hijau', 100, 20, 0.9, 4.6, 0.2, 'capsicum pepper bell pepper hijau green raw salad');
  a('Moringa Leaves / Daun Kelor', 50, 64, 9.4, 8.3, 1.4, 'daun kelor moringa leaves superfood soup curry');
  a('Banana Flower / Bunga Pisang', 100, 51, 1.6, 11.4, 0.1, 'bunga pisang banana flower blossom kerabu curry');
  a('Young Jackfruit / Nangka Muda (cooked)', 150, 92, 1.7, 22.9, 0.3, 'nangka muda young jackfruit masak curry lemak cooked');
  a('Cassava Leaves / Daun Ubi Kayu', 100, 58, 5.7, 9.1, 0.9, 'daun ubi kayu cassava leaves masak rebus');
  a('Fern Shoots / Pucuk Paku', 100, 34, 4.6, 5.5, 0.4, 'pucuk paku fern shoots fiddlehead cooked belacan');
  a('Corn / Jagung (boiled, cob)', 150, 86, 3.3, 19, 1.4, 'jagung corn boiled sweet corn rebus cob');
  a('Sweet Potato Leaves / Pucuk Ubi', 100, 42, 2.7, 8.2, 0.4, 'pucuk ubi sweet potato leaves masak cooked goreng');
  a('Four-Angle Bean / Kacang Botol', 100, 49, 3.6, 9, 0.3, 'kacang botol four angle bean winged bean wingbean');
  a('Long Bean / Kacang Panjang (cooked)', 100, 47, 2.7, 9.7, 0.3, 'kacang panjang long bean masak cooked goreng curry');
  a('Eggplant / Terung (cooked)', 100, 25, 0.9, 6.1, 0.2, 'terung eggplant brinjal aubergine cooked curry masak');
  a('Daikon / Lobak Putih (cooked)', 100, 18, 0.6, 4, 0.1, 'lobak putih daikon white radish cooked soup rebus');
  a('Watercress / Selada Air', 100, 11, 2.3, 1.3, 0.1, 'selada air watercress cooked soup rebus');
  a('Mung Bean Sprouts / Taugeh (raw)', 100, 30, 3.1, 5.9, 0.2, 'taugeh bean sprouts mung bean raw fresh');
  a('Taugeh (stir-fried)', 100, 35, 3, 4.4, 1.4, 'taugeh bean sprouts goreng stir fry masak');
  a('Pea Shoots / Pucuk Pea', 100, 35, 3.6, 5.4, 0.5, 'pea shoots pucuk pea masak goreng');
  a('Snow Peas / Snap Peas', 100, 42, 2.8, 7.6, 0.2, 'snow peas snap peas pea pods stir fry');
  a('Sweet Potato / Keledek Oren (boiled)', 130, 86, 1.6, 20.1, 0.1, 'keledek sweet potato orange boiled rebus');
  a('Purple Sweet Potato / Keledek Ungu', 130, 90, 2, 21, 0.1, 'keledek ungu purple sweet potato boiled rebus');
  a('Taro / Keladi Ubi (boiled)', 130, 112, 1.5, 26.5, 0.2, 'keladi taro ubi cooked boiled soup rebus');
  a('Lotus Seeds / Biji Teratai (cooked)', 30, 89, 4.1, 17.3, 0.5, 'biji teratai lotus seeds dessert tong sui soup');
  a('Dried Lily Buds / Bunga Lily Kering', 20, 294, 6.7, 69.1, 0.7, 'bunga lily dried lily buds chinese vegetable soup');
  a('Wood Ear Fungus / Cendawan Telinga (rehydrated)', 100, 20, 0.5, 5, 0.1, 'cendawan telinga wood ear fungus black fungus vegetable soup');
  a('Enoki Mushroom / Cendawan Enoki', 100, 37, 2.7, 7.6, 0.3, 'enoki mushroom cendawan enoki golden needle mushroom soup steamboat');
  a('Oyster Mushroom / Cendawan Tiram', 100, 33, 3.3, 6.1, 0.4, 'oyster mushroom cendawan tiram masak goreng stir fry');
  a('Shiitake Mushroom (cooked)', 80, 56, 1.6, 14.4, 0.2, 'shiitake mushroom cendawan masak cooked soup');
  a('King Oyster Mushroom', 100, 35, 2.5, 6.8, 0.3, 'king oyster mushroom cendawan besar masak goreng');
  a('Asparagus (steamed)', 100, 22, 2.4, 4.1, 0.2, 'asparagus steam cooked salted egg butter');
  a('French Beans / String Beans (cooked)', 100, 31, 1.8, 7, 0.1, 'french beans string beans haricot vert masak goreng');
  a('Baby Corn / Jagung Baby', 50, 26, 2.3, 5.5, 0.3, 'baby corn jagung baby corn small stir fry soup');
  a('Water Spinach / Kangkung (cooked)', 100, 19, 2.6, 2.7, 0.4, 'kangkung water spinach morning glory masak belacan goreng stir fry');

  // ── ASIAN / MALAYSIAN FRUITS ─────────────────────────────────────────
  a('Pomelo / Limau Bali', 150, 38, 0.8, 9.6, 0, 'pomelo limau bali citrus fruit segar');
  a('Langsat / Duku', 100, 57, 1, 14, 0.2, 'langsat duku fruit buah segar');
  a('Salak / Snake Fruit', 60, 82, 0.4, 20.9, 0.1, 'salak snake fruit buah sala segar');
  a('Ciku / Sapodilla', 100, 83, 0.4, 20, 1.1, 'ciku sapodilla naseberry buah segar');
  a('Calamansi / Limau Kasturi', 20, 30, 0.8, 9.9, 0.1, 'limau kasturi calamansi lime citrus small juice masam');
  a('Tamarind Pulp / Asam Jawa', 20, 239, 2.8, 62.5, 0.6, 'asam jawa tamarind pulp masam sour cooking');
  a('Passion Fruit / Markisa', 100, 97, 2.2, 23.4, 0.7, 'passion fruit markisa buah segar');
  a('Lychee / Laici', 100, 66, 0.8, 16.5, 0.4, 'lychee laici litchi buah segar');
  a('Kiwi Fruit', 80, 61, 1.1, 14.7, 0.5, 'kiwi kiwifruit green gold buah segar');
  a('Persimmon / Buah Kesemek', 100, 70, 0.6, 18.6, 0.2, 'persimmon kesemek buah segar');
  a('Dates / Kurma (fresh)', 30, 277, 1.8, 75, 0.2, 'kurma dates fresh dried buah');
  a('Medjool Dates', 24, 277, 1.8, 74.9, 0.2, 'medjool dates kurma fresh dried');
  a('Peach / Pic', 100, 39, 0.9, 9.5, 0.3, 'peach pic buah segar');
  a('Plum', 80, 46, 0.7, 11.4, 0.3, 'plum buah segar');
  a('Pear / Pear Cina', 150, 57, 0.4, 15.1, 0.1, 'pear pear cina asian pear buah segar');
  a('Blueberry', 100, 57, 0.7, 14.5, 0.3, 'blueberry buah segar');
  a('Strawberry / Strawberi', 100, 32, 0.7, 7.7, 0.3, 'strawberry strawberi buah segar');
  a('Pomegranate / Buah Delima', 100, 83, 1.7, 18.7, 1.2, 'pomegranate buah delima seeds aril segar');
  a('Cantaloupe / Rock Melon', 200, 34, 0.8, 8.2, 0.2, 'cantaloupe rock melon melon buah segar');
  a('Honeydew Melon', 200, 36, 0.5, 9.1, 0.1, 'honeydew melon buah segar');
  a('Lime / Limau Nipis', 30, 30, 0.7, 10.5, 0.2, 'limau nipis lime citrus juice masam sour');
  a('Lemon', 50, 29, 1.1, 9.3, 0.3, 'lemon citrus juice masam sour yellow');
  a('Coconut Flesh (fresh)', 50, 354, 3.3, 15.2, 33.5, 'coconut flesh kelapa segar fresh');
  a('Avocado', 100, 160, 2, 8.5, 14.7, 'avocado alpukat creamy fruit');
  a('Mulberry / Murbei', 100, 43, 1.4, 9.8, 0.4, 'mulberry murbei buah segar');
  a('Soursop / Durian Belanda', 100, 66, 1, 16.8, 0.3, 'soursop durian belanda graviola buah segar');
  a('Starfruit / Belimbing (sweet)', 100, 31, 1, 6.7, 0.3, 'belimbing starfruit sweet carambola buah segar');

  // ── SEAFOOD ───────────────────────────────────────────────────────────
  a('Cuttlefish / Sotong (cooked)', 100, 79, 16.2, 0.8, 0.7, 'sotong cuttlefish squid masak cooked goreng');
  a('Dried Cuttlefish / Sotong Kering', 30, 310, 58.9, 5.6, 4.8, 'sotong kering dried cuttlefish snack');
  a('Clam / Kerang (steamed)', 100, 148, 25.6, 5.1, 1.9, 'kerang clam cockle steamed masak');
  a('Mussel / Kupang (steamed)', 100, 172, 23.8, 7.4, 4.5, 'kupang mussel steamed masak');
  a('Scallop (steamed)', 80, 111, 20.5, 5.4, 0.8, 'scallop steamed masak');
  a('Abalone / Abalon (canned)', 80, 105, 17.1, 6.3, 0.8, 'abalon abalone canned tinned masak');
  a('Sea Cucumber / Timun Laut (cooked)', 100, 38, 8.9, 0.3, 0.3, 'timun laut sea cucumber masak stew braised');
  a('Stingray / Ikan Pari (grilled)', 150, 113, 21.5, 0, 2.9, 'ikan pari stingray grilled bakar sambal pedas');
  a('Pomfret / Ikan Bawal (steamed)', 180, 148, 20.2, 0, 7.4, 'ikan bawal pomfret steamed masak fish');
  a('Snakehead Fish / Ikan Haruan', 150, 99, 20.7, 0, 1.5, 'ikan haruan snakehead fish masak');
  a('Threadfin / Ikan Kurau', 150, 132, 21.7, 0, 5.1, 'ikan kurau threadfin masak goreng fish');
  a('Wolf Herring / Ikan Parang', 120, 138, 22.5, 0, 5.4, 'ikan parang wolf herring masak goreng fish');
  a('Red Snapper / Ikan Merah (steamed)', 180, 128, 26.3, 0, 1.7, 'ikan merah red snapper steamed masak taucho fish');
  a('Grouper / Ikan Kerapu (steamed)', 180, 92, 19.4, 0, 1, 'ikan kerapu grouper steamed masak fish restaurant');
  a('Dory Fish (pan-fried)', 120, 148, 17, 0, 8.5, 'dory fish pan fried goreng tepung batter');
  a('Dried Salted Fish / Ikan Masin', 30, 244, 51.4, 0, 3.3, 'ikan masin salted fish dried goreng');
  a('Anchovies / Ikan Bilis (dried)', 15, 308, 64.4, 0, 4.5, 'ikan bilis anchovies dried fried crispy nasi lemak');
  a('Ikan Bilis (fried crispy)', 15, 450, 56, 6, 22, 'ikan bilis fried crispy nasi lemak sambal goreng');
  a('Jellyfish (prepared)', 100, 39, 6.8, 0, 1, 'jellyfish ubur jellyfish appetizer chinese restaurant');
  a('Frog Legs / Paha Katak (cooked)', 100, 73, 16.4, 0, 0.3, 'paha katak frog legs masak cooked porridge congee');

  // ── POULTRY & MEAT ────────────────────────────────────────────────────
  a('Chicken Drumstick (grilled, skin on)', 120, 195, 23.1, 0, 11, 'chicken drumstick grilled paha ayam masak bakar');
  a('Chicken Thigh (braised)', 130, 179, 20.5, 0, 10.7, 'chicken thigh braised paha ayam masak stew');
  a('Chicken Wing (deep-fried)', 80, 289, 21.1, 6, 21, 'chicken wing fried goreng ayam masak crispy');
  a('Chicken Feet / Kaki Ayam (cooked)', 100, 215, 19.4, 0.2, 14.6, 'kaki ayam chicken feet cooked braised dim sum');
  a('Chicken Gizzard / Pedal Ayam', 100, 154, 27.5, 0, 3.7, 'pedal ayam chicken gizzard masak cooked stir fry');
  a('Chicken Liver / Hati Ayam', 100, 165, 26.5, 0.9, 5.5, 'hati ayam chicken liver masak cooked');
  a('Duck / Itik (roasted)', 150, 201, 19.7, 0, 13.3, 'itik duck roasted panggang masak');
  a('Duck Breast (skinless, cooked)', 130, 140, 23.5, 0, 5, 'duck breast itik cooked masak');
  a('Beef Rendang (dry)', 150, 193, 21.5, 3.5, 10.5, 'rendang daging beef rendang dry masak raya festival');
  a('Beef Short Ribs / Rusuk Pendek (braised)', 120, 222, 24.3, 0, 14.1, 'rusuk pendek beef ribs braised masak stew');
  a('Mutton / Daging Kambing Curry', 150, 209, 25.7, 3.2, 10.6, 'daging kambing mutton curry masak');
  a('Liver / Hati Lembu (sauteed)', 100, 191, 29.1, 4.9, 5.3, 'hati lembu beef liver sauteed masak goreng');
  a('Pork Belly / Sio Bak (roasted)', 120, 518, 11.9, 0, 53, 'sio bak char siu pork belly roasted chinese');
  a('Char Siu / BBQ Pork', 100, 271, 24, 13, 13.3, 'char siu bbq pork roasted chinese babi sweet');
  a('Quail / Puyuh (whole, cooked)', 100, 234, 25, 0, 14, 'puyuh quail whole cooked masak');
  a('Turkey Breast (roasted)', 130, 161, 30.1, 0, 3.7, 'turkey breast roasted cooked western');

  // ── TRADITIONAL MALAYSIAN HAWKER FOODS ──────────────────────────────
  a('Nasi Lemak (full set with egg & sambal)', 400, 165, 5.8, 20.8, 7.2, 'nasi lemak rice coconut milk sambal egg ikan bilis full set national dish');
  a('Nasi Lemak (rice + sambal only)', 200, 149, 3.2, 27, 3.8, 'nasi lemak rice coconut milk sambal plain nasi lemak bungkus');
  a('Nasi Lemak Ayam (chicken)', 450, 171, 9.4, 21, 6.1, 'nasi lemak ayam chicken full set sambal coconut rice');
  a('Nasi Goreng Kampung', 350, 170, 6, 29, 4.5, 'nasi goreng kampung village fried rice spicy anchovy');
  a('Nasi Goreng Seafood', 350, 175, 8, 28, 4.8, 'nasi goreng seafood fried rice sotong prawn');
  a('Nasi Goreng Pattaya', 380, 183, 8.5, 30, 5.2, 'nasi goreng pattaya omelette fried rice wrapped');
  a('Nasi Goreng USA', 350, 180, 8, 29, 5, 'nasi goreng usa fried rice chicken egg');
  a('Nasi Briyani Ayam', 400, 195, 12, 30, 5.5, 'nasi briyani briani biryani chicken ayam rice spiced');
  a('Nasi Briyani Kambing', 400, 210, 14, 29, 6.5, 'nasi briyani biryani mutton kambing rice spiced');
  a('Nasi Kandar (plate)', 400, 200, 14, 28, 5, 'nasi kandar rice curry lauk mixed penang rice plate');
  a('Nasi Dagang', 350, 178, 7, 30, 4.5, 'nasi dagang terengganu coconut glutinous rice gulai');
  a('Nasi Kerabu', 350, 160, 8, 26, 4, 'nasi kerabu blue rice herb salad kelantan rice');
  a('Nasi Tomato', 300, 190, 6, 34, 4.5, 'nasi tomato tomato rice lauk ayam masak merah special');
  a('Nasi Minyak', 200, 220, 3.8, 36, 7, 'nasi minyak ghee rice festive raya weddings');
  a('Nasi Ayam / Chicken Rice (Hainanese)', 400, 195, 13, 28, 5, 'nasi ayam chicken rice hainanese hainan poached rice soup soy sauce');
  a('Nasi Ayam (roasted)', 400, 205, 14, 28, 5.5, 'nasi ayam roasted chicken rice hainanese');
  a('Nasi Campur (mixed rice plate)', 400, 185, 12, 27, 5, 'nasi campur mixed rice lauk assorted economy rice');
  a('Economy Rice (3 lauk)', 400, 180, 12, 26, 5.2, 'economy rice nasi campur mixed lauk 3 lauk chinese');
  a('Claypot Chicken Rice', 400, 210, 14, 32, 5, 'claypot chicken rice belachan dark soy sauce cooked clay pot');
  a('Char Kuey Teow', 400, 175, 7, 28, 5, 'char kuey teow fried flat rice noodle prawn cockle egg soy dark');
  a('Char Kway Teow (big prawn)', 400, 190, 10, 27, 5.5, 'char kuey teow big prawn udang besar fried noodle');
  a('Chee Cheong Fun (prawn paste)', 200, 130, 4.2, 25, 1.8, 'chee cheong fun rice roll prawn paste hae ko dim sum breakfast');
  a('Chee Cheong Fun (soy sauce)', 200, 120, 3.8, 23, 1.5, 'chee cheong fun rice roll soy sauce breakfast dim sum');
  a('Wonton Mee (dry)', 350, 148, 8.5, 24, 3.1, 'wonton mee dry noodle dumpling char siu pork noodle');
  a('Wonton Mee (soup)', 400, 105, 7.5, 17, 2, 'wonton mee soup noodle dumpling clear soup');
  a('Pan Mee (dry)', 350, 155, 9, 25, 3.5, 'pan mee dry hand-pulled noodle ikan bilis');
  a('Pan Mee (soup)', 400, 120, 8, 18, 2.5, 'pan mee soup hand-pulled noodle ikan bilis');
  a('Dry Pan Mee Spicy', 350, 165, 9, 26, 4, 'pan mee spicy dry chili oil ikan bilis pork mince');
  a('Hokkien Mee (KL style)', 400, 188, 10, 28, 5, 'hokkien mee kl kuala lumpur dark soy pork lard prawn yellow noodle');
  a('Hokkien Mee (Penang style)', 400, 145, 9, 22, 3.2, 'hokkien mee penang prawn noodle soup mee udang');
  a('Prawn Noodle / Mee Udang', 500, 130, 9, 19, 2.5, 'mee udang prawn noodle soup spicy penang');
  a('Curry Laksa', 500, 120, 6, 15, 5, 'curry laksa noodle coconut milk curry thick soup prawn');
  a('Assam Laksa (Penang)', 500, 105, 5, 18, 2, 'assam laksa penang sour fish tamarind noodle');
  a('Sarawak Laksa', 500, 110, 6, 16, 3, 'sarawak laksa sambal belacan coconut milk rice vermicelli');
  a('Laksam (Kelantan)', 400, 115, 5.5, 18, 2.5, 'laksam kelantan rice roll coconut gravy fish');
  a('Mee Goreng Mamak', 350, 175, 7, 29, 4.5, 'mee goreng mamak indian fried noodle yellow prawn tofu spicy');
  a('Mee Goreng Basah', 350, 165, 7, 27, 4, 'mee goreng basah wet fried noodle gravy tomato');
  a('Mee Rebus', 400, 150, 7, 25, 3.5, 'mee rebus yellow noodle sweet potato gravy boiled noodle');
  a('Mee Siam', 400, 140, 6, 24, 3, 'mee siam thin rice noodle sweet sour gravy prawn');
  a('Bihun Goreng (fried vermicelli)', 300, 160, 5, 27, 4, 'bihun goreng fried rice vermicelli noodle stir fry');
  a('Bihun Soup', 400, 90, 5, 15, 1.5, 'bihun soup rice vermicelli clear soup chicken');
  a('Koay Teow Th\'ng (soup)', 500, 85, 5, 14, 1.5, 'koay teow soup flat rice noodle clear broth penang');
  a('Lor Mee (braised noodle)', 400, 145, 8, 23, 3, 'lor mee braised noodle thick starchy gravy egg prawn pork');
  a('Char Bee Hoon', 300, 155, 5.5, 25, 4, 'char bee hoon fried rice vermicelli bihun goreng');
  a('Mee Kolok (Sarawak)', 300, 165, 7.5, 27, 4, 'mee kolok sarawak dry noodle char siu barbecue pork');
  a('Kampua Mee (Sibu)', 300, 158, 7, 26, 3.8, 'kampua mee sibu sarawak dry noodle pork lard');
  a('Ipoh Hor Fun (steamed, chicken)', 400, 130, 9.5, 20, 2.5, 'ipoh hor fun flat rice noodle chicken silky steamed poached perak');
  a('Kway Chap (braised pork)', 500, 120, 9, 15, 3.5, 'kway chap braised pork intestine rice sheet noodle dark soy soup');
  a('Roti Canai (plain)', 100, 301, 7.6, 43.2, 12.1, 'roti canai plain flatbread indian flaky breakfast mamak');
  a('Roti Canai with Curry', 200, 220, 7, 32, 8, 'roti canai curry dhal dal breakfast mamak');
  a('Roti Canai Telur (egg)', 130, 290, 9.8, 38, 12, 'roti canai telur egg flatbread breakfast mamak');
  a('Roti Canai Bawang (onion)', 120, 295, 7.5, 42, 12, 'roti canai bawang onion flatbread breakfast mamak');
  a('Roti Tissue', 60, 350, 6.5, 50, 15, 'roti tissue crispy thin flatbread sweet mamak');
  a('Roti Boom', 90, 338, 7, 47, 15, 'roti boom thick layered flatbread breakfast mamak sweet');
  a('Tosai / Dosa (plain)', 100, 168, 4.7, 33.7, 2.1, 'tosai dosa indian pancake fermented rice lentil breakfast');
  a('Tosai / Dosa (egg)', 150, 190, 7.5, 32, 4, 'tosai dosa egg indian breakfast');
  a('Idli (steam)', 60, 154, 4.7, 30, 1.5, 'idli idly steam rice cake south indian breakfast');
  a('Vadai / Papadam', 50, 442, 19.6, 63.7, 16.5, 'vadai papadam lentil fritter south indian snack breakfast');
  a('Thosai Masala', 200, 185, 6, 30, 5.8, 'thosai masala potato filling dosa indian');
  a('Naan (plain)', 130, 262, 8.7, 47.4, 5, 'naan flatbread indian tandoor plain breakfast');
  a('Tandoori Chicken (half)', 250, 158, 28.5, 1.5, 4.5, 'tandoori chicken ayam half masak spiced grilled indian');
  a('Fish Head Curry', 300, 130, 14, 6.5, 6, 'fish head curry kepala ikan kari curry spicy');
  a('Fish Curry / Kari Ikan', 200, 115, 13.5, 4, 5, 'kari ikan fish curry masak lemak spicy');
  a('Chicken Curry / Kari Ayam (Malaysian)', 200, 180, 18, 5, 10, 'kari ayam chicken curry masak lemak spicy santan');
  a('Dhal Curry / Kari Dal', 200, 118, 7.5, 18.5, 1.8, 'dal dhal curry kari lentil masak vegetarian');
  a('Sambal Udang (prawn sambal)', 150, 135, 14, 5.5, 7, 'sambal udang prawn sambal spicy shrimp');
  a('Asam Pedas Ikan (sour spicy fish)', 200, 105, 12, 4.5, 4, 'asam pedas ikan sour spicy fish tamarind masak melayu');
  a('Gulai Lemak Ayam (coconut gravy)', 200, 195, 16, 4.5, 13, 'gulai lemak ayam chicken coconut gravy masak lemak');
  a('Masak Lemak Cili Api (chicken)', 200, 185, 16, 4, 12, 'masak lemak cili api chicken padi chilli coconut gravy negeri sembilan');
  a('Masak Lemak Ikan Patin', 200, 170, 15, 3.5, 11, 'masak lemak ikan patin patin fish coconut gravy pahang');
  a('Sambal Tumis', 50, 148, 3.5, 13.2, 9.2, 'sambal tumis cooked sambal chilli belacan sauce condiment');
  a('Begedil / Bergedel (potato patty)', 70, 185, 4.5, 24.5, 8, 'begedil bergedel potato patty fried mashed corn patty soto nasi');
  a('Soto Ayam (Malaysian)', 500, 90, 7.5, 11, 2.5, 'soto ayam chicken soup lontong rice cake turmeric clear broth');
  a('Sup Ayam (chicken soup)', 400, 55, 6.5, 3.5, 1.5, 'sup ayam chicken soup clear clear broth');
  a('Sup Tulang (bone soup)', 400, 65, 7, 3, 2.8, 'sup tulang bone soup beef oxtail clear broth');
  a('Bakso (meatball soup)', 400, 95, 8.5, 9, 3, 'bakso meatball soup beef pork clear broth');
  a('Satay Ayam (per skewer)', 25, 155, 17, 4.2, 8, 'satay ayam chicken skewer grilled peanut sauce');
  a('Satay Lembu / Daging (per skewer)', 25, 165, 17.5, 3.5, 9.5, 'satay daging beef skewer grilled peanut sauce');
  a('Satay Kambing (per skewer)', 25, 168, 16, 4, 10, 'satay kambing mutton skewer grilled peanut sauce');
  a('Peanut Satay Sauce / Kuah Kacang', 50, 230, 8, 16, 16, 'kuah kacang satay peanut sauce kacang peanut sweet spicy');
  a('Nasi Padang (full plate)', 400, 200, 13, 27, 6, 'nasi padang indonesian rice lauk mixed');
  a('Ayam Penyet (pressed fried chicken)', 200, 225, 22, 8, 12, 'ayam penyet indonesian fried chicken sambal pressed');
  a('Ayam Goreng Berempah (spiced)', 150, 268, 25, 5, 17, 'ayam goreng berempah spiced fried chicken herbs crispy');
  a('Ikan Bakar (grilled fish)', 150, 118, 22, 0, 3.5, 'ikan bakar grilled fish sambal wrapped banana leaf');
  a('Sotong Goreng Tepung (squid rings)', 150, 235, 17, 18, 10, 'sotong goreng tepung squid rings calamari fried batter');
  a('Udang Goreng Butter (butter prawn)', 150, 210, 18, 7, 12.5, 'udang goreng butter butter prawn crispy prawn golden');
  a('Kailan Ikan Masin (kailan salted fish)', 150, 80, 5, 5, 5, 'kailan ikan masin salted fish stir fry chinese vegetable');
  a('Steamed Fish with Ginger Soy', 200, 120, 22, 2, 3, 'steamed fish ginger soy sauce masak stim ikan');
  a('Yong Tau Foo (assorted)', 300, 95, 7.5, 10, 2.5, 'yong tau foo stuffed tofu fish paste assorted steam soup');
  a('Popiah (fresh)', 150, 125, 5.5, 18, 4, 'popiah fresh spring roll soft wrapper prawn egg vegetable');
  a('Popiah Goreng (fried)', 100, 245, 6, 26, 13, 'popiah goreng fried spring roll crispy prawn');
  a('Cucur Udang (prawn fritter)', 50, 225, 8, 25, 11, 'cucur udang prawn fritter goreng crispy snack jajan');
  a('Cucur Badak (sweet potato fritter)', 80, 195, 3, 32, 7, 'cucur badak sweet potato purple fritter snack');
  a('Otak-Otak (grilled fish cake)', 50, 130, 12, 6, 7, 'otak otak grilled fish cake spiced banana leaf grill charcoal');
  a('Keropok Lekor (terengganu)', 60, 245, 12, 34, 7, 'keropok lekor terengganu fish sausage fried steamed snack');
  a('Keropok Goreng (fried fish cracker)', 30, 390, 14, 52, 15, 'keropok goreng fried fish cracker snack');
  a('Pasembur / Rojak Mamak', 300, 130, 5, 18, 5, 'pasembur rojak mamak prawn fritter tofu cucumber prawn paste sauce');
  a('Rojak Buah (fruit rojak)', 300, 95, 2, 22, 1.5, 'rojak buah fruit salad shrimp paste sauce hae ko sweet');
  a('Pisang Goreng (banana fritter)', 80, 225, 2.5, 40, 7, 'pisang goreng banana fritter fried snack jajan goreng pisang');
  a('Ubi Goreng (cassava fries)', 100, 210, 1.5, 42, 5, 'ubi goreng cassava fries tapioca fried snack');
  a('Cendol', 350, 155, 1.5, 38, 2, 'cendol pandan jelly coconut milk gula melaka shaved ice dessert');
  a('ABC / Ais Batu Campur', 350, 148, 2, 36, 2, 'abc ais batu campur ice kacang shaved ice red bean corn jelly');
  a('Durian Crepe', 120, 260, 4.5, 34, 12, 'durian crepe crepe cake layered');
  a('Durian Ice Cream', 100, 215, 3, 27, 11, 'durian ice cream ais krim durian');
  a('Pulut Durian', 200, 285, 4, 48, 9.5, 'pulut durian glutinous rice sticky rice durian coconut milk');
  a('Bubur Pulut Hitam', 250, 150, 3, 33, 2, 'bubur pulut hitam black glutinous rice pudding coconut milk dessert');
  a('Bubur Kacang Hijau', 250, 130, 5, 27, 1.5, 'bubur kacang hijau mung bean porridge dessert sweet');
  a('Bubur Lambuk (Ramadan)', 400, 105, 4.5, 19, 2, 'bubur lambuk ramadan porridge rice vegetables spiced');
  a('Congee / Bubur Nasi (plain)', 400, 60, 1.8, 13.2, 0.3, 'bubur nasi congee plain porridge rice');
  a('Chicken Congee / Bubur Ayam', 400, 85, 5.5, 14.5, 1.5, 'bubur ayam chicken congee porridge breakfast dim sum');
  a('Fish Congee / Bubur Ikan', 400, 80, 7, 13, 1, 'bubur ikan fish congee porridge');
  a('Chendol Ais', 350, 155, 1.5, 38, 2, 'chendol cendol pandan jelly ais gula melaka shaved ice');

  // ── STATE SPECIALTY DISHES ───────────────────────────────────────────
  a('Beef Rendang (Negeri Sembilan)', 150, 193, 21.5, 3.5, 10.5, 'rendang daging beef rendang negeri sembilan dry');
  a('Pengat Pisang', 250, 155, 1.5, 36, 2.8, 'pengat pisang banana coconut milk dessert sweet');
  a('Lontong (Johor)', 400, 155, 7, 25, 3.5, 'lontong rice cake vegetable coconut sauce johor');
  a('Murtabak (large)', 200, 255, 12, 32, 8.5, 'murtabak stuffed pancake beef chicken egg mamak large');
  a('Murtabak (small)', 100, 255, 12, 32, 8.5, 'murtabak stuffed pancake beef chicken egg mamak small');
  a('Nasi Ulam (Kelantan/Terengganu)', 350, 145, 5, 25, 3.5, 'nasi ulam herb rice kelantan terengganu traditional');
  a('Gulai Patin Tempoyak', 200, 180, 16, 4.5, 11, 'gulai patin tempoyak fermented durian fish pahang perak');
  a('Asam Pedas Melaka', 200, 110, 12, 5, 4.5, 'asam pedas melaka sour fish melaka spicy');
  a('Otak-Otak Muar (grilled)', 50, 128, 11.5, 6, 7, 'otak otak muar johor grilled fish cake spiced');
  a('Kolo Mee (Sarawak)', 300, 162, 8, 26, 3.8, 'kolo mee sarawak dry noodle char siu pork egg dry');
  a('Umai (Sarawak raw fish salad)', 150, 85, 14, 4.5, 1.5, 'umai sarawak raw fish salad lime onion sour');

  // ── KUIH / MALAYSIAN DESSERTS & SNACKS ──────────────────────────────
  a('Kuih Lapis (layered)', 60, 178, 2, 37, 3, 'kuih lapis layered colourful steamed rice flour coconut milk');
  a('Kuih Seri Muka (glutinous base, pandan top)', 60, 190, 3, 39, 3.5, 'kuih seri muka pandan custard glutinous rice coconut');
  a('Kuih Talam (coconut pandan)', 60, 155, 2.5, 32, 3, 'kuih talam pandan coconut steamed rice flour');
  a('Kuih Dadar (pandan roll)', 60, 188, 3, 30, 7, 'kuih dadar pandan coconut roll crepe green');
  a('Kuih Ondeh-Ondeh', 60, 205, 2, 42, 4, 'kuih ondeh ondeh onde onde gula melaka pandan rice ball coconut');
  a('Onde-Onde / Buah Melaka', 60, 205, 2, 42, 4, 'onde onde buah melaka gula melaka pandan rice ball');
  a('Kuih Bangkit (tapioca)', 30, 338, 3, 79, 3, 'kuih bangkit tapioca coconut biscuit raya festive');
  a('Kuih Bahulu', 30, 330, 7, 60, 6.5, 'kuih bahulu sponge cake egg semperit raya festive');
  a('Kuih Semperit', 25, 430, 5.5, 63, 18, 'kuih semperit butter cookies raya festive cornflour');
  a('Kuih Nastar (pineapple tart)', 20, 420, 5, 58, 19, 'kuih nastar pineapple tart raya festive pastry jam');
  a('Kuih Kapit / Love Letter', 15, 470, 5.5, 70, 17, 'kuih kapit love letter wafer egg crispy raya festive');
  a('Dodol', 50, 352, 1.5, 80, 6.5, 'dodol sticky toffee gula melaka glutinous rice raya sweet');
  a('Wajik (glutinous rice cake)', 60, 310, 2.5, 71, 4, 'wajik glutinous rice gula melaka coconut sweet');
  a('Apam Balik (peanut)', 120, 295, 7, 50, 8, 'apam balik turnover peanut sweet corn crispy thin pancake');
  a('Apam Balik (thick, soft)', 150, 260, 7.5, 46, 6, 'apam balik thick soft pancake peanut sweet corn');
  a('Banana Leaf Ice Cream (1 scoop)', 80, 170, 3, 28, 6, 'banana leaf ice cream scoop pandan ice krim');
  a('Jelly / Agar-Agar (coconut)', 150, 85, 1.5, 20, 1.5, 'agar agar jelly coconut milk pandan dessert');
  a('Pulut Panggang', 80, 240, 4, 45, 5.5, 'pulut panggang grilled glutinous rice coconut filling banana leaf');
  a('Lemang (bamboo glutinous rice)', 120, 260, 4, 50, 6, 'lemang bamboo glutinous rice coconut milk raya festival');
  a('Ketupat (rice dumpling)', 120, 155, 3, 35, 0.5, 'ketupat rice dumpling coconut leaf raya festival');
  a('Tapai / Tapé (fermented)', 100, 150, 1.5, 36, 0.5, 'tapai tape fermented glutinous rice sweet');
  a('Pisang Goreng Cheese (banana fritter cheese)', 90, 270, 4, 43, 9, 'pisang goreng cheese banana fritter cheese topping');
  a('Cekodok Pisang (banana puff)', 60, 235, 3.5, 38, 8, 'cekodok pisang banana puff fritter kuih snack');
  a('Epok-Epok / Karipap (curry puff, baked)', 65, 268, 6.5, 32, 13, 'epok epok karipap curry puff baked pastry filling potato');
  a('Karipap Goreng (fried)', 65, 310, 6.5, 32, 18, 'karipap goreng curry puff fried pastry filling potato chicken');
  a('Kuih Cincin', 30, 480, 4, 70, 20, 'kuih cincin ring donuts fried raya festive');
  a('Bingka Ubi (cassava cake)', 100, 235, 2, 50, 4, 'bingka ubi cassava cake coconut milk baked steam');
  a('Kuih Kasturi', 50, 200, 2.5, 42, 3, 'kuih kasturi pandan coconut sweet');
  a('Serawa Kelapa (grated coconut dessert)', 100, 285, 3, 35, 16, 'serawa kelapa grated coconut gula melaka coconut dessert sweet');
  a('Kuih Penjaram', 50, 280, 2.5, 50, 8, 'kuih penjaram fried brown sugar rice flour crispy snack');
  a('Puteri Mandi (coconut ball)', 60, 220, 3, 43, 5, 'puteri mandi coconut ball grated coconut pandan dessert');
  a('Burbur Cha-Cha', 250, 160, 2, 34, 3.5, 'bubur cha cha bubur chacha coconut milk sweet potato yam jelly colourful');

  // ── MALAYSIAN BEVERAGES ──────────────────────────────────────────────
  a('Teh Tarik (with full milk)', 300, 55, 2.2, 8.5, 1.8, 'teh tarik pulled tea milk tea mamak kaw sweet');
  a('Teh Tarik (less sweet, kurang manis)', 300, 38, 2, 5.5, 1.5, 'teh tarik kurang manis less sweet mamak tea');
  a('Teh O Limau (black tea lime)', 350, 18, 0.3, 4.5, 0, 'teh o limau black tea lime iced less sweet kopitiam');
  a('Teh O Ais (iced black tea)', 350, 35, 0.3, 8.5, 0, 'teh o ais iced black tea sweet kopitiam');
  a('Teh C (evaporated milk tea)', 300, 60, 2.5, 9, 2, 'teh c evaporated milk tea kopitiam kaw');
  a('Kopi O (black coffee)', 250, 10, 0.3, 2, 0.1, 'kopi o black coffee kopitiam plain sugar optional');
  a('Kopi (white coffee with condensed milk)', 250, 95, 2, 16, 3, 'kopi white coffee condensed milk kopitiam sweet');
  a('Kopi C (evaporated milk coffee)', 250, 55, 2.5, 7, 2.2, 'kopi c evaporated milk coffee kopitiam');
  a('Kopi Ais (iced white coffee)', 350, 95, 2, 16, 3, 'kopi ais iced white coffee condensed milk kopitiam sweet');
  a('Old Town White Coffee (hot)', 220, 88, 2, 16, 2.5, 'old town white coffee hot kopitiam cafe');
  a('Milo O Ais (less sweet)', 350, 60, 1.8, 12.5, 0.8, 'milo o ais kurang manis less sweet iced milo');
  a('Milo Dinosaur (thick)', 350, 155, 4.5, 28, 3.5, 'milo dinosaur thick milo iced extra powder top');
  a('Milo Godzilla', 400, 170, 5, 31, 4, 'milo godzilla extra thick iced cream');
  a('Horlicks Ais', 350, 140, 4, 26, 3, 'horlicks ais iced malt drink');
  a('Nestlo Ais', 350, 130, 3.5, 24, 3, 'nestlo nestle ais iced milk drink');
  a('Bandung (rose syrup milk)', 300, 110, 2, 22, 2, 'bandung rose syrup condensed milk pink drink sweet');
  a('Air Sirap (syrup water)', 250, 90, 0, 22, 0, 'air sirap rose syrup cordial iced drink sweet');
  a('Air Barli (barley water)', 300, 70, 0.5, 17, 0.1, 'air barli barley water iced drink sweet');
  a('Air Tebu (sugarcane juice)', 300, 74, 0.5, 19, 0.1, 'air tebu sugarcane juice segar fresh drink');
  a('Air Kelapa Muda (fresh coconut water)', 300, 19, 0.7, 3.7, 0.2, 'air kelapa muda fresh coconut water young coconut');
  a('Limau Ais (lime juice iced)', 350, 40, 0.3, 10, 0.1, 'limau ais lime juice iced drink segar fresh');
  a('Iced Lemon Tea', 350, 55, 0.2, 14, 0, 'iced lemon tea lemon tea iced drink');
  a('Cham (coffee + tea mix)', 300, 70, 2, 12, 2, 'cham coffee tea mixed kopitiam unique');
  a('Cincau Ais (grass jelly)', 350, 55, 0.5, 13.5, 0.1, 'cincau grass jelly iced cold drink black jelly');
  a('Coconut Shake', 400, 210, 2.5, 30, 9.5, 'coconut shake ice cream coconut blended drink');
  a('Carrot Ginger Juice', 300, 55, 1.2, 12.5, 0.3, 'carrot ginger juice fresh healthy vegetable juice');
  a('ABC Sirap (shaved ice)', 300, 120, 1.5, 28, 1.5, 'abc sirap shaved ice kacang red bean sweet corn corn pandan');
  a('Red Bull (250ml)', 250, 45, 0.4, 11, 0, 'red bull energy drink 250ml tin');
  a('100 Plus (330ml)', 330, 23, 0, 5.9, 0, '100 plus isotonic drink soda 330ml f&n');
  a('Pokka Green Tea (500ml)', 500, 18, 0, 4.5, 0, 'pokka green tea bottle drink 500ml');
  a('Yeo\'s Soya Bean Drink', 250, 48, 2.5, 6.5, 1.5, 'yeo soya bean drink soymilk soy beancurd');
  a('Yeo\'s Chrysanthemum Tea', 250, 40, 0.2, 10, 0, 'yeo chrysanthemum tea drink canned chinese');
  a('F&N Orange Carbonated (325ml)', 325, 42, 0, 10.5, 0, 'f&n orange fizzy carbonated soda drink');
  a('Dutch Lady UHT Full Cream (200ml)', 200, 62, 3.3, 4.8, 3.6, 'dutch lady uht full cream milk 200ml box');
  a('Dutch Lady Chocolate Milk (200ml)', 200, 80, 3.2, 12, 2, 'dutch lady chocolate milk drink box 200ml');

  // ── BUBBLE TEA CHAINS ─────────────────────────────────────────────────
  a('Chatime Pearl Milk Tea (M)', 500, 110, 1.5, 25, 2, 'chatime pearl milk tea boba tapioca medium bubble tea');
  a('Chatime Roasted Milk Tea', 500, 100, 1.5, 23, 1.8, 'chatime roasted milk tea boba bubble tea');
  a('Tealive Classic Milk Tea (M)', 500, 105, 1.5, 24, 2, 'tealive classic milk tea boba bubble tea medium');
  a('Tealive Milo Dinosaur (bubble tea)', 500, 165, 3.5, 32, 3.5, 'tealive milo dinosaur bubble tea');
  a('Gong Cha Milk Tea with Pearls (M)', 500, 115, 1.8, 26, 2.2, 'gong cha milk tea pearls boba medium bubble tea');
  a('Gong Cha Matcha Latte (M)', 500, 120, 2, 25, 2.5, 'gong cha matcha latte green tea bubble tea');
  a('KOI The Milk Tea with Pearls (M)', 500, 120, 1.8, 27, 2, 'koi the bubble tea milk tea pearls medium');
  a('Xing Fu Tang Brown Sugar Milk Tea', 500, 130, 2, 28, 3, 'xing fu tang brown sugar milk tea tiger boba');
  a('Tiger Sugar Bubble Tea', 500, 135, 2, 29, 3, 'tiger sugar brown sugar milk tea boba pearls');
  a('Boost Juice Mango Passionfruit (M)', 450, 88, 1.5, 21, 0.3, 'boost juice mango passionfruit smoothie medium');
  a('Boost Juice Strawberry Squeeze (M)', 450, 80, 1.3, 19, 0.2, 'boost juice strawberry smoothie medium fresh');
  a('Taro Milk Tea with Pearls', 500, 120, 1.8, 27, 2, 'taro milk tea purple yam boba pearls bubble tea');
  a('Matcha Milk Tea with Pearls', 500, 120, 2, 25, 2.5, 'matcha milk tea green tea boba pearls bubble tea');
  a('Brown Sugar Boba Milk', 500, 140, 2.5, 30, 3, 'brown sugar boba milk pearls bubble tea gula melaka');
  a('Yakult Drink (65ml)', 65, 71, 1.2, 16, 0, 'yakult probiotic drink small bottle fermented milk');

  // ── McDONALD\'S MALAYSIA ───────────────────────────────────────────────
  a('McD Ayam GCB (Grilled Chicken Burger)', 200, 215, 16, 26, 6, 'mcdonalds gcb grilled chicken burger ayam grill');
  a('McD Ayam Spicy (Spicy Chicken McDeluxe)', 200, 280, 18, 30, 10, 'mcdonalds spicy chicken mcdeluxe ayam spicy burger');
  a('McD Nasi Lemak Burger', 200, 260, 16, 29, 9, 'mcdonalds nasi lemak burger malaysia special');
  a('McD Big Mac', 210, 257, 13, 31, 13, 'mcdonalds big mac burger beef double patty');
  a('McD Quarter Pounder with Cheese', 200, 268, 17, 30, 12.5, 'mcdonalds quarter pounder cheese beef burger');
  a('McD McChicken', 160, 270, 15, 31, 12, 'mcdonalds mcchicken chicken burger crispy');
  a('McD Filet-O-Fish', 145, 250, 14, 30, 10, 'mcdonalds filet o fish fish burger tartar sauce');
  a('McD McNuggets 6pc', 105, 272, 16, 18, 16, 'mcdonalds mcnuggets 6 piece chicken nuggets');
  a('McD McNuggets 9pc', 157, 272, 16, 18, 16, 'mcdonalds mcnuggets 9 piece chicken nuggets');
  a('McD French Fries (Medium)', 117, 320, 4, 44, 15, 'mcdonalds french fries medium potato wedge');
  a('McD French Fries (Large)', 154, 320, 4, 44, 15, 'mcdonalds french fries large potato');
  a('McD McFlurry Oreo', 200, 185, 4, 31, 6, 'mcdonalds mcflurry oreo ice cream dessert');
  a('McD Chocolate Sundae', 150, 185, 4, 32, 5, 'mcdonalds chocolate sundae ice cream dessert');
  a('McD Vanilla Soft Serve Cone', 90, 165, 3.5, 27, 5, 'mcdonalds vanilla soft serve cone ice cream');
  a('McD Apple Pie', 75, 267, 3, 40, 13, 'mcdonalds apple pie baked pastry dessert');
  a('McD Sausage McMuffin with Egg', 165, 280, 15, 29, 13, 'mcdonalds sausage mcmuffin egg breakfast muffin');
  a('McD Hotcakes (3pc)', 150, 210, 5.5, 39, 5, 'mcdonalds hotcakes pancakes breakfast 3pc');
  a('McD Hash Brown', 53, 310, 3, 31, 20, 'mcdonalds hash brown potato breakfast crispy');
  a('McD Double Beef Burger', 195, 265, 15, 30, 12, 'mcdonalds double beef burger economy burger');

  // ── KFC MALAYSIA ──────────────────────────────────────────────────────
  a('KFC Original Chicken (per pc)', 130, 234, 21, 9.5, 13, 'kfc original chicken fried piece drumstick thigh');
  a('KFC Zinger Burger', 200, 258, 18, 32, 10, 'kfc zinger burger spicy chicken crispy');
  a('KFC Zinger Double Down', 210, 390, 30, 18, 25, 'kfc zinger double down chicken bun');
  a('KFC Chicken Snack Plate', 390, 175, 12, 25, 5, 'kfc snack plate rice mashed potato gravy chicken');
  a('KFC Whipped Potato (regular)', 100, 80, 2, 15, 2, 'kfc whipped mashed potato regular gravy');
  a('KFC Coleslaw (regular)', 100, 110, 1, 14, 6, 'kfc coleslaw regular salad');
  a('KFC Corn on the Cob', 150, 100, 3.5, 20, 1.5, 'kfc corn cob side');
  a('KFC Popcorn Chicken (regular)', 135, 305, 17, 22, 16, 'kfc popcorn chicken bites regular crispy');
  a('KFC Hot & Spicy (per pc)', 130, 240, 21, 9.5, 14, 'kfc hot spicy piece chicken fried crispy');
  a('KFC Box Meal (1pc + side + drink)', 580, 165, 10, 22, 5.5, 'kfc box meal one piece side drink set');

  // ── OTHER FAST FOOD CHAINS MALAYSIA ──────────────────────────────────
  a('Texas Chicken (Original, per pc)', 120, 230, 21, 8, 14, 'texas chicken original piece fried chicken crispy');
  a('Texas Chicken (Spicy, per pc)', 120, 235, 21, 8, 14.5, 'texas chicken spicy piece fried chicken crispy');
  a('Marrybrown Chicken (per pc)', 120, 228, 21, 8.5, 13.5, 'marrybrown chicken piece fried malaysian fast food');
  a('Marrybrown Nasi Lemak Set', 380, 165, 11, 22, 5, 'marrybrown nasi lemak set malaysian fast food chicken');
  a('Burger King Whopper', 290, 237, 12, 27, 12, 'burger king whopper beef burger flame grilled');
  a('Burger King Chicken Royale', 210, 255, 15, 31, 11, 'burger king chicken royale crispy chicken burger');
  a('Burger King Onion Rings (regular)', 91, 356, 4, 44, 19, 'burger king onion rings regular side crispy');
  a('Nando\'s 1/4 Chicken (Lemon & Herb)', 250, 230, 29, 1.5, 12, 'nandos quarter chicken lemon herb peri peri');
  a('Nando\'s 1/4 Chicken (Hot)', 250, 232, 29, 2, 12, 'nandos quarter chicken hot peri peri spicy');
  a('Nando\'s Peri Peri Chips (regular)', 125, 290, 4, 38, 14, 'nandos peri peri chips fries regular');
  a('Nando\'s Corn on the Cob', 115, 100, 3.5, 20, 1.5, 'nandos corn on the cob side');
  a('Subway 6" Chicken Teriyaki', 230, 197, 15, 32, 4, 'subway 6 inch chicken teriyaki sub sandwich');
  a('Subway 6" Tuna', 230, 195, 13, 30, 5, 'subway 6 inch tuna sub sandwich');
  a('Subway 6" Veggie Delite', 195, 155, 7, 30, 2.5, 'subway 6 inch veggie delite sub sandwich');
  a('Pizza Hut Personal Pan Pizza (per slice)', 80, 255, 11, 32, 9, 'pizza hut personal pan pizza slice cheese');
  a('Pizza Hut Stuffed Crust (per slice)', 115, 265, 13, 33, 9.5, 'pizza hut stuffed crust pizza slice cheese');
  a('Domino\'s Pepperoni (per slice)', 85, 260, 11.5, 30, 10, 'dominos pepperoni pizza slice regular');
  a('Domino\'s Chicken Feast (per slice)', 90, 240, 13, 28, 9, 'dominos chicken feast pizza slice');
  a('A&W Waffle Dog', 90, 295, 10, 35, 13, 'aw aAndw waffle dog corn dog sausage waffle');
  a('A&W Rootbeer Float (medium)', 400, 100, 1.5, 23, 2, 'aw rootbeer float medium ice cream soda');
  a('A&W Coney Dog', 135, 300, 13, 28, 15, 'aw aw coney dog hot dog cheese sausage');
  a('Sushi King Unagi Don', 300, 190, 12, 30, 4.5, 'sushi king unagi don eel rice fried rice japanese');
  a('Sushi King Salmon Sushi (per pc)', 30, 135, 5, 22, 3, 'sushi king salmon sushi piece nigiri rice');
  a('The Chicken Rice Shop (full set)', 400, 200, 14, 28, 5.5, 'chicken rice shop full set hainanese rice soy');
  a('PappaRich Char Siu Rice', 350, 210, 13, 29, 6, 'papparich char siu rice bbq pork soy sauce');
  a('OldTown White Coffee (Ice, M)', 350, 145, 2.5, 28, 3.5, 'oldtown old town white coffee iced medium cafe');
  a('Starbucks Caramel Frappuccino (Tall)', 354, 126, 2, 27, 4, 'starbucks caramel frappuccino tall blended coffee sweet');
  a('Starbucks Vanilla Latte (Tall)', 354, 100, 4.5, 15, 3.5, 'starbucks vanilla latte tall coffee milk');
  a('Starbucks Java Chip Frappuccino (Tall)', 354, 146, 3, 29, 4.5, 'starbucks java chip frappuccino tall blended');

  // ── GROCERY / PACKAGED FOODS (LOCAL BRANDS) ─────────────────────────
  a('Maggi Mee Goreng (1 pack cooked)', 100, 490, 13, 71, 18, 'maggi mee goreng instant noodle fried one pack dry cook', 'Maggi');
  a('Maggi Mee Tomyam (1 pack cooked)', 300, 115, 4.5, 20, 2.5, 'maggi tomyam instant noodle soup cooked cook', 'Maggi');
  a('Maggi Mee Ayam (1 pack cooked)', 300, 110, 4.5, 19, 2.2, 'maggi instant noodle chicken ayam soup cooked', 'Maggi');
  a('Maggi Mee Kari (1 pack cooked)', 300, 120, 5, 20, 3.5, 'maggi kari curry instant noodle soup cooked', 'Maggi');
  a('Mamee Monster Noodle Snack (1 pack)', 25, 480, 9, 60, 22, 'mamee monster noodle snack dry crunch eat raw bag', 'Mamee');
  a('Mamee Daebak Ghost Pepper Noodle (cooked)', 90, 490, 12, 70, 20, 'mamee daebak ghost pepper noodle hot spicy instant', 'Mamee');
  a('Ibumie Penang Hokkien Mee (cooked)', 300, 110, 5, 20, 2, 'ibumie penang hokkien mee instant noodle soup prawn', 'IbuMie');
  a('Myojo Char Mee (cooked)', 100, 460, 11, 66, 17, 'myojo char mee instant fried noodle dry dark soy', 'Myojo');
  a('Cintan Chicken Noodle (cooked)', 300, 100, 4, 18.5, 2, 'cintan chicken ayam instant noodle soup cooked', 'Cintan');
  a('Gardenia White Bread (1 slice)', 35, 268, 8.5, 50, 3.8, 'gardenia white bread slice loaf sandwich', 'Gardenia');
  a('Gardenia Butterscotch Bread (1 slice)', 35, 295, 8, 54, 5.5, 'gardenia butterscotch bread slice loaf sweet', 'Gardenia');
  a('Massimo White Bread (1 slice)', 30, 268, 8.4, 50, 3.5, 'massimo white bread slice loaf sandwich', 'Massimo');
  a('High 5 White Bread (1 slice)', 30, 265, 8, 50, 3.5, 'high 5 white bread slice loaf sandwich', 'High 5');
  a('Kaya (coconut egg jam, 1 tbsp)', 20, 260, 3.5, 49, 7, 'kaya coconut jam egg green brown spread bread toast');
  a('SCS Butter (salted, 1 tbsp)', 14, 717, 0.9, 0.1, 81, 'scs butter salted spread 1 tbsp tablespoon toast', 'SCS');
  a('Planta Margarine (1 tbsp)', 14, 700, 0, 0.2, 80, 'planta margarine spread toast 1 tbsp', 'Planta');
  a('Hup Seng Cream Cracker (2 pcs)', 25, 435, 9, 66, 15, 'hup seng cream cracker biscuit 2 pcs plain', 'Hup Seng');
  a('Julie\'s Peanut Butter Sandwich (3 pcs)', 45, 478, 11, 65, 19, 'julies peanut butter sandwich biscuit 3 pcs', 'Julie\'s');
  a('Munchy\'s Oat Krunch Choco (1 bar)', 26, 450, 8, 65, 17, 'munchys oat krunch chocolate bar biscuit', 'Munchy\'s');
  a('Biskut Raya Marie Assorted (per 100g)', 100, 420, 8, 72, 13, 'biskut marie biscuit plain assorted raya');
  a('Tiger Biscuit (2 pcs)', 20, 450, 8, 70, 15, 'tiger biscuit cream sandwich classic', 'Tiger');
  a('Jacob\'s Cream Cracker (2 pcs)', 25, 430, 9, 65, 15, 'jacobs cream cracker biscuit plain 2pcs', 'Jacob\'s');
  a('Oreo (3 pcs)', 34, 480, 5, 71, 20, 'oreo sandwich biscuit cookies 3pcs chocolate cream', 'Oreo');
  a('Cheezels (1 pack, 60g)', 60, 535, 7, 58, 32, 'cheezels cheese ring puffed snack 1 pack', 'Cheezels');
  a('Twisties Chicken (1 pack, 60g)', 60, 525, 5.5, 58, 30, 'twisties chicken corn puff snack 1 pack', 'Twisties');
  a('Pringles Original (per 100g)', 100, 534, 6.7, 55, 34, 'pringles original chips potato crisps can', 'Pringles');
  a('Jack \'n Jill Potato Chips (1 pack)', 55, 540, 6, 56, 33, 'jack jill potato chips crispy snack pack', 'Jack n Jill');
  a('Milo (3 tsp in milk, ready)', 250, 130, 6, 21, 3, 'milo chocolate malt drink milk hot cold powder nestle', 'Milo');
  a('Nescafe Classic 2-in-1 (1 sachet)', 200, 55, 1, 10.5, 1, 'nescafe 2 in 1 instant coffee sachet', 'Nescafe');
  a('Nescafe 3-in-1 Classic (1 sachet)', 200, 100, 1.5, 18, 2.5, 'nescafe 3 in 1 instant coffee sachet milk sugar', 'Nescafe');
  a('Brahim\'s Rendang Daging (pack)', 180, 165, 17, 4.5, 9.5, 'brahims rendang daging ready meal pack masak', 'Brahim\'s');
  a('Brahim\'s Nasi Briyani (pack)', 300, 185, 8, 30, 5, 'brahims nasi briyani ready meal pack masak', 'Brahim\'s');
  a('Adabi Curry Powder (1 tsp)', 5, 300, 10, 50, 10, 'adabi curry powder rempah kari 1 tsp teaspoon', 'Adabi');
  a('Cap Ibu Kurma Paste', 50, 150, 3, 20, 7, 'cap ibu kurma paste kurma cooking ready paste', 'Cap Ibu');
  a('Ayam Brand Tuna in Water (185g)', 90, 109, 25, 0, 1, 'ayam brand tuna in water canned tin protein', 'Ayam Brand');
  a('Ayam Brand Tuna in Oil (185g)', 90, 195, 25, 0, 11, 'ayam brand tuna in oil canned tin', 'Ayam Brand');
  a('Ayam Brand Sardine in Tomato (215g)', 100, 168, 20, 1.5, 9, 'ayam brand sardine tomato canned tin fish', 'Ayam Brand');
  a('Jalen/Adabi Sambal Ikan Bilis', 30, 195, 5, 22, 10, 'sambal ikan bilis bottled ready paste jar cooking');
  a('Kimball Tomato Ketchup (1 tbsp)', 17, 112, 1.2, 27, 0.1, 'kimball tomato ketchup sauce 1 tbsp tablespoon', 'Kimball');
  a('Maggi Chili Sauce (1 tbsp)', 17, 95, 0.5, 23, 0, 'maggi chilli sauce 1 tbsp tablespoon bottle', 'Maggi');
  a('Tiger Oyster Sauce (1 tbsp)', 15, 35, 0.7, 7.5, 0.2, 'oyster sauce tiram 1 tbsp tablespoon stir fry');
  a('Prego Tomato Pasta Sauce (1/2 cup)', 130, 50, 1.5, 10, 1, 'prego tomato pasta sauce jar cooking', 'Prego');
  a('Sunquick Orange Cordial (diluted)', 250, 45, 0, 11, 0, 'sunquick orange cordial diluted juice drink', 'Sunquick');
  a('Vono Instant Soup Chicken (1 sachet)', 250, 65, 3, 10, 1.5, 'vono instant soup chicken sachet hot drink', 'Vono');
  a('Campbell\'s Chicken Soup (half can)', 212, 75, 3.5, 9, 2, 'campbells chicken soup canned tin ready heat', 'Campbell\'s');
  a('Nestlé Munch Bar', 35, 490, 6, 64, 24, 'nestle munch bar chocolate candy wafer', 'Nestlé');
  a('Kit Kat (2 fingers)', 21, 502, 6.3, 63, 26, 'kitkat kit kat chocolate wafer fingers 2', 'KitKat');
  a('Cadbury Dairy Milk (1 row, 4 squares)', 25, 535, 8, 58, 30, 'cadbury dairy milk chocolate bar row squares', 'Cadbury');
  a('Milo Chocolate Bar (Nuggets)', 30, 460, 5.5, 66, 19, 'milo chocolate bar nuggets chocolate snack', 'Milo');
  a('Ferrero Rocher (1 pc)', 12.5, 570, 8, 54, 39, 'ferrero rocher chocolate hazelnut 1 piece', 'Ferrero Rocher');

  // ── JAPANESE FOODS ────────────────────────────────────────────────────
  a('Sushi Rice (vinegared)', 150, 175, 3.6, 38.8, 0.3, 'sushi rice vinegar seasoned japanese shari');
  a('Salmon Sashimi (per slice)', 25, 179, 20.1, 0, 12.4, 'salmon sashimi raw slice japanese fresh fish');
  a('Tuna Sashimi (per slice)', 25, 132, 29.9, 0, 0.9, 'tuna sashimi maguro raw slice japanese fresh fish');
  a('Salmon Nigiri (per pc)', 40, 155, 8, 21, 4.5, 'salmon nigiri sushi piece rice japanese');
  a('Tuna Nigiri (per pc)', 40, 140, 9, 21, 3, 'tuna nigiri sushi piece rice japanese maguro');
  a('Ebi Nigiri (per pc)', 40, 130, 7.5, 22, 1.5, 'ebi shrimp prawn nigiri sushi piece rice japanese');
  a('California Roll (6 pcs)', 180, 155, 5.5, 26, 4, 'california roll sushi maki crab cucumber avocado 6pcs');
  a('Dragon Roll (8 pcs)', 240, 180, 7, 28, 5.5, 'dragon roll sushi avocado shrimp tempura 8pcs');
  a('Spicy Tuna Roll (6 pcs)', 180, 165, 8.5, 25, 4.5, 'spicy tuna roll sushi maki 6pcs japanese');
  a('Temaki Salmon (1 pc)', 100, 165, 7.5, 21, 5.5, 'temaki salmon hand roll cone sushi japanese');
  a('Salmon Teriyaki Rice Bowl', 350, 185, 14, 27, 4, 'salmon teriyaki rice bowl donburi japanese');
  a('Chicken Katsu Don (pork or chicken)', 400, 200, 14, 29, 5, 'katsu don chicken pork cutlet egg rice bowl donburi japanese');
  a('Gyudon / Beef Bowl', 400, 188, 12, 28, 5, 'gyudon beef bowl donburi japanese rice');
  a('Ramen (Tonkotsu)', 600, 95, 6.5, 12, 3, 'ramen tonkotsu pork bone broth soup noodle japanese');
  a('Ramen (Shoyu/Soy)', 600, 80, 6, 12, 2, 'ramen shoyu soy sauce soup noodle japanese');
  a('Ramen (Miso)', 600, 90, 7, 12, 2.5, 'ramen miso soup noodle japanese');
  a('Miso Soup', 250, 15, 1.5, 2, 0.5, 'miso soup japanese starter tofu wakame seaweed');
  a('Gyoza (pan-fried, 3 pcs)', 75, 245, 10, 28, 11, 'gyoza dumplings pan fried potsticker pork 3pcs japanese');
  a('Takoyaki (3 pcs)', 90, 205, 7, 26, 8, 'takoyaki octopus ball 3pcs japanese street food');
  a('Tempura Prawn (1 pc)', 40, 180, 8.5, 15, 9, 'tempura prawn battered fried japanese 1 piece');
  a('Tempura Vegetables (assorted)', 150, 180, 3, 24, 8.5, 'tempura vegetables battered fried japanese assorted');
  a('Edamame (boiled, salted)', 100, 122, 11, 9.9, 5.2, 'edamame boiled soybean salted japanese snack appetizer');
  a('Karaage Chicken (3 pcs)', 90, 290, 17.5, 16, 17, 'karaage chicken fried japanese crispy juicy 3pcs');
  a('Okonomiyaki (Japanese pancake)', 200, 175, 8, 25, 5.5, 'okonomiyaki japanese pancake savory cabbage egg pork');
  a('Yakitori Chicken (per skewer)', 30, 175, 15, 5, 10, 'yakitori chicken skewer grilled japanese sweet soy glaze');
  a('Udon Soup (plain)', 400, 90, 3.5, 19, 0.5, 'udon soup noodle plain japanese thick white noodle');
  a('Udon Stir Fry (Yaki Udon)', 350, 125, 5.5, 22, 2.5, 'yaki udon stir fried noodle japanese vegetables');
  a('Soba Noodle (chilled)', 250, 130, 5.5, 27, 0.5, 'soba buckwheat noodle chilled cold japanese');
  a('Inari Sushi (per pc)', 40, 150, 4, 26, 3.5, 'inari sushi tofu pouch sweet rice japanese');
  a('Japanese Egg Pudding / Purin', 80, 115, 3.5, 17, 3.8, 'purin japanese egg pudding custard caramel dessert');

  // ── KOREAN FOODS ─────────────────────────────────────────────────────
  a('Bibimbap (with egg)', 550, 165, 8, 28, 4, 'bibimbap korean rice bowl mixed vegetables egg sesame');
  a('Korean Fried Chicken (2 pcs)', 180, 315, 22, 18, 18, 'korean fried chicken crispy 2pcs dakgangjeong sweet spicy');
  a('Korean Chicken (soy garlic)', 180, 305, 22, 17, 17, 'korean fried chicken soy garlic 2pcs');
  a('Tteokbokki (rice cake)', 250, 150, 4.5, 30, 2, 'tteokbokki rice cake spicy gochujang korean street food');
  a('Kimbap / Gimbap (per roll cut piece)', 40, 140, 4.5, 25, 2.5, 'kimbap gimbap korean seaweed rice roll 1 slice');
  a('Ramyeon / Korean Instant Noodle (cooked)', 300, 130, 5.5, 22, 4, 'ramyeon korean instant noodle shin ramyun spicy soup cooked');
  a('Shin Ramyun (cooked)', 300, 135, 6, 22, 4.5, 'shin ramyun korean ramen noodle spicy instant cook', 'Nongshim');
  a('Samyang Hot Chicken 2x Spicy (cooked)', 130, 509, 14, 71, 20, 'samyang hot chicken spicy ramen noodle 2x fire cook dry', 'Samyang');
  a('Bulgogi Beef (BBQ beef)', 150, 215, 19, 12, 10, 'bulgogi korean bbq beef marinated barbecue grilled');
  a('Korean BBQ Samgyeopsal (pork belly)', 150, 360, 17, 0, 32, 'samgyeopsal korean bbq pork belly grilled');
  a('Sundubu Jjigae (soft tofu stew)', 400, 75, 5.5, 5.5, 3, 'sundubu jjigae soft tofu stew spicy korean soup');
  a('Korean Doenjang Jjigae (soybean paste)', 400, 80, 5.5, 7, 3, 'doenjang jjigae korean soybean paste stew soup');
  a('Kimchi Fried Rice', 300, 175, 6, 32, 4, 'kimchi fried rice bokkeumbap korean spicy');
  a('Korean Corn Dog (1 pc)', 100, 280, 9, 35, 12, 'korean corn dog hotdog cheese mozzarella fried stick 1pc');

  // ── THAI FOODS ────────────────────────────────────────────────────────
  a('Pad Thai (chicken)', 400, 175, 10, 26, 5, 'pad thai fried rice noodle chicken prawn egg thai stir fry');
  a('Tom Yum Soup (clear)', 400, 50, 4.5, 4.5, 1.5, 'tom yum soup clear prawn chicken thai spicy sour lemongrass');
  a('Tom Kha Gai (coconut milk soup)', 400, 110, 7.5, 5.5, 7, 'tom kha gai coconut milk soup chicken thai galangal');
  a('Thai Green Curry (chicken)', 300, 130, 10.5, 6, 8.5, 'thai green curry chicken coconut milk spicy thai');
  a('Thai Red Curry (beef)', 300, 140, 12, 6, 9, 'thai red curry beef coconut milk thai spicy');
  a('Thai Basil Chicken (Pad Krapow)', 300, 175, 16, 8.5, 8, 'pad krapow thai basil chicken fried minced over rice');
  a('Mango Sticky Rice (Thai dessert)', 250, 210, 3, 46, 4, 'mango sticky rice khao niao mamuang thai dessert sweet');
  a('Som Tam (green papaya salad)', 200, 80, 2, 17, 1.5, 'som tam green papaya salad thai spicy sour lime');
  a('Satay Thai (per skewer)', 30, 155, 17, 4.5, 8, 'satay thai grilled chicken pork peanut sauce skewer');
  a('Thai Milk Tea (iced)', 350, 110, 2, 24, 2, 'thai milk tea iced orange tea condensed milk sweet');
  a('Thai Iced Coffee', 350, 100, 2, 22, 2, 'thai iced coffee nam oliang sweet cold iced');

  // ── INDONESIAN FOODS ──────────────────────────────────────────────────
  a('Gado-Gado (peanut vegetable salad)', 350, 155, 8, 18, 7, 'gado gado indonesian vegetable peanut sauce salad');
  a('Ayam Penyet (Indonesian fried chicken)', 200, 225, 22, 8, 12, 'ayam penyet indonesian smashed fried chicken sambal');
  a('Nasi Padang (mixed rice plate)', 400, 200, 13, 27, 6, 'nasi padang indonesian mixed rice lauk assorted rendang');
  a('Indomie Goreng (dry, cooked)', 100, 491, 10, 69, 19, 'indomie goreng dry fried instant noodle indonesian cooked', 'Indomie');
  a('Indomie Mi Goreng (cooked)', 100, 491, 10, 69, 19, 'indomie mi goreng dry instant noodle indonesian', 'Indomie');
  a('Tempe / Tempeh (fried)', 100, 230, 19.5, 12, 11.5, 'tempe tempeh fried goreng soy fermented indonesian protein');
  a('Tempeh Bacem (sweet-braised)', 100, 220, 18.5, 14, 10.5, 'tempeh bacem braised sweet soy java indonesian');
  a('Pecel (Javanese peanut sauce veg)', 250, 130, 6.5, 18, 5, 'pecel javanese peanut sauce vegetables indonesian');

  // ── CHINESE MALAYSIAN / DIM SUM ───────────────────────────────────────
  a('Har Gow / Prawn Dumpling (3 pcs)', 75, 140, 9.5, 18, 3, 'har gow prawn dumpling shrimp dim sum 3pcs steamed chinese');
  a('Siu Mai / Shumai (3 pcs)', 75, 160, 11, 16, 5.5, 'siu mai pork shrimp dumpling open dim sum 3pcs steamed chinese');
  a('Char Siu Pao / BBQ Pork Bun (steamed)', 75, 255, 9.5, 38, 7, 'char siu pao bbq pork bun bao steamed dim sum chinese');
  a('Char Siu Pao (baked)', 75, 310, 9, 42, 12, 'char siu pao baked bbq pork bun dim sum chinese');
  a('Lo Mai Gai / Glutinous Rice Chicken', 200, 200, 9, 32, 4.5, 'lo mai gai glutinous sticky rice chicken dim sum lotus leaf wrap');
  a('Cheong Fun (steamed rice roll, BBQ pork)', 120, 130, 5.5, 21, 3, 'cheong fun steamed rice roll bbq pork char siu dim sum');
  a('Turnip Cake / Chai Tow Kway (fried)', 150, 175, 3.5, 24, 7.5, 'chai tow kway turnip cake radish cake fried black white egg chye tow');
  a('Tofu Puff / Tauhu Goreng Stuffed', 80, 190, 11, 10, 13, 'tauhu goreng stuffed tofu puff fish paste prawn');
  a('Braised Pork Knuckle', 200, 310, 23, 3, 23, 'braised pork knuckle ter kah pata babi braised chinese');
  a('Bak Kut Teh (pork ribs tea)', 500, 80, 8, 2.5, 4.5, 'bak kut teh pork ribs soup clear herbal chinese breakfast klang');
  a('Bak Kut Teh (dark, claypot)', 400, 100, 10, 4, 5, 'bak kut teh dark claypot pork chinese penang ipoh');
  a('White Radish Soup / Lobak Soup', 400, 45, 2, 8.5, 0.8, 'lobak soup white radish daikon pork rib clear soup chinese');
  a('Prawn Paste Chicken / Har Cheong Gai', 150, 295, 20, 14, 19, 'har cheong gai prawn paste chicken fried crispy chinese cantonese');
  a('Braised Tofu / Tauhu Masak Tiram', 150, 120, 8.5, 7, 7, 'tauhu braised tofu oyster sauce chinese masak');
  a('Tofu with Minced Pork (Mapo Tofu style)', 200, 110, 8, 6, 6.5, 'mapo tofu minced pork spicy sichuan tofu dish chinese');
  a('Steamed Egg / Chawanmushi style', 150, 70, 6, 3, 3.5, 'steamed egg soft silky savory dish chinese');
  a('Chinese Fried Rice (Nasi Goreng Cina)', 350, 168, 6.5, 28, 4.5, 'nasi goreng cina chinese fried rice egg simple');
  a('Tong Sui (sweet soup, red bean)', 250, 125, 4.5, 28, 0.5, 'tong sui red bean sweet soup dessert chinese');

  // ── MAMAK / INDIAN-MALAYSIAN EXTRAS ─────────────────────────────────
  a('Banana Leaf Rice (full set)', 450, 185, 12, 28, 5, 'banana leaf rice set full south indian vegetarian curry fish chicken');
  a('Briyani Lamb / Mutton', 400, 215, 15, 29, 6.5, 'briyani biryani lamb mutton kambing rice spiced indian');
  a('Butter Chicken Masala', 200, 180, 17.5, 7.5, 9.5, 'butter chicken masala murgh makhani indian curry');
  a('Palak Paneer (spinach cheese)', 200, 155, 8, 9, 10, 'palak paneer spinach cheese paneer indian vegetarian curry');
  a('Paneer Tikka (grilled)', 150, 235, 17.5, 6, 15.5, 'paneer tikka grilled marinated cheese indian tandoor');
  a('Raita (yogurt dip)', 100, 62, 2.8, 8, 2, 'raita yogurt dip cucumber mint indian condiment');
  a('Papadom / Papadum', 15, 380, 22, 57, 5, 'papadom papadum crispy lentil cracker starter indian');
  a('Sambal (fresh chilli paste)', 30, 65, 1.5, 12, 2, 'sambal fresh chilli paste belacan spicy condiment');
  a('Mutton Chop (fried)', 180, 285, 26, 6.5, 17, 'mutton chop fried daging kambing western mamak');
  a('Mee Goreng Indian (plain)', 350, 168, 6.5, 28, 4.5, 'mee goreng indian plain mamak fried noodle');

  // ── WESTERN & CAFÉ FOODS ─────────────────────────────────────────────
  a('Aglio e Olio Pasta (chicken)', 350, 280, 16, 40, 8, 'aglio olio pasta chicken garlic olive oil italian western cafe');
  a('Carbonara Pasta', 350, 310, 16, 42, 10, 'carbonara pasta cream cheese egg bacon western cafe');
  a('Bolognese Pasta', 350, 280, 16, 40, 8, 'bolognese pasta meat sauce beef italian western');
  a('Lasagne (beef)', 300, 220, 13, 22, 9.5, 'lasagne beef cheese layered pasta baked western');
  a('Caesar Salad (no croutons)', 200, 135, 6, 7, 10, 'caesar salad dressing parmesan chicken western cafe');
  a('Greek Salad', 200, 100, 4, 10, 6, 'greek salad feta olive cucumber tomato western');
  a('Club Sandwich (3-tier)', 250, 255, 16, 30, 9, 'club sandwich turkey chicken egg 3 tier western cafe');
  a('Fish & Chips', 400, 240, 14, 27, 9.5, 'fish chips battered fried potato western british');
  a('Mushroom Soup (cream, 1 bowl)', 250, 95, 2.5, 10, 5.5, 'mushroom cream soup western bowl cafe starter');
  a('Waffle with Ice Cream', 180, 290, 6.5, 43, 11, 'waffle ice cream dessert western cafe sweet');
  a('Pancake Stack (3pc with syrup)', 200, 270, 7, 51, 6, 'pancake stack 3pcs maple syrup butter western brunch');
  a('English Breakfast (full)', 450, 195, 16, 14, 11, 'english breakfast full set sausage egg bacon toast beans western');
  a('Overnight Oats', 250, 140, 6, 24, 3.5, 'overnight oats chia seed milk healthy breakfast');
  a('Granola with Yogurt', 200, 195, 7.5, 30, 6.5, 'granola yogurt breakfast bowl healthy');
  a('Acai Bowl', 300, 150, 3.5, 29, 4, 'acai bowl smoothie bowl fresh fruit granola healthy');
  a('Cheesecake (New York style, per slice)', 120, 335, 6.5, 35, 20, 'cheesecake new york style slice dessert cafe');
  a('Tiramisu (per slice)', 120, 310, 6, 34, 18, 'tiramisu slice italian dessert coffee cream cake');
  a('Chocolate Lava Cake', 100, 380, 6, 47, 20, 'chocolate lava cake molten fondant dessert cafe');
  a('Banana Foster / Banana Split', 250, 285, 4, 48, 10, 'banana foster split ice cream caramel western dessert cafe');

  // ── DAIRY & EGGS ──────────────────────────────────────────────────────
  a('Greek Yogurt (plain, full fat)', 150, 97, 9, 3.6, 5, 'greek yogurt plain full fat high protein breakfast snack');
  a('Greek Yogurt (non-fat)', 150, 59, 10.2, 3.6, 0.4, 'greek yogurt non fat low fat high protein breakfast snack');
  a('Yogurt Drink / Vitagen (65ml)', 65, 57, 1.8, 11.5, 0.8, 'vitagen yogurt drink fermented milk probiotic small');
  a('Cheddar Cheese (slice)', 28, 402, 25, 2.4, 33, 'cheddar cheese slice yellow dairy protein');
  a('Mozzarella Cheese (shredded)', 28, 300, 22, 2.2, 22, 'mozzarella cheese shredded pizza pasta dairy');
  a('Cream Cheese (1 tbsp)', 15, 350, 6, 4, 34, 'cream cheese 1 tbsp spread dairy breakfast bagel');
  a('Soft Boiled Egg (1 pc)', 55, 155, 12.6, 0.7, 10.6, 'soft boiled egg 1pc telur separuh masak kopitiam');
  a('Hard Boiled Egg (1 pc)', 55, 155, 12.6, 1.1, 10.6, 'hard boiled egg 1pc telur rebus');
  a('Century Egg / Pitan Dan (1 pc)', 60, 135, 9, 2, 10, 'century egg pitan pei dan preserved egg chinese');
  a('Salted Egg / Telur Masin (1 pc)', 55, 165, 12, 1, 12, 'salted egg telur masin cooked yolk');
  a('Telur Dadar (omelette, plain)', 120, 175, 11.5, 1, 13.5, 'telur dadar omelette plain fried egg cook');
  a('Scrambled Egg (2 eggs)', 100, 175, 11, 2, 13.5, 'scrambled egg telur scrambled cook breakfast');

  // ── GRAINS & NOODLES ─────────────────────────────────────────────────
  a('Paratha / Roti Wholemeal', 100, 275, 8, 38, 10, 'paratha wholemeal flatbread roti whole wheat baked fried');
  a('Chapati (plain)', 60, 238, 7.5, 43, 4.5, 'chapati plain flatbread indian wholemeal baked');
  a('Yellow Noodle / Mee Kuning (raw)', 100, 280, 8, 60, 2, 'mee kuning yellow noodle fresh raw uncooked');
  a('Yellow Noodle (cooked, plain)', 150, 135, 4.5, 26, 1.5, 'mee kuning yellow noodle cooked plain boiled');
  a('Glass Noodle / Mung Bean Thread (dry)', 50, 350, 0.2, 86.1, 0.1, 'glass noodle mung bean thread dry tang hoon soun');
  a('Glass Noodle (cooked)', 100, 95, 0.1, 23.7, 0, 'glass noodle cooked tang hoon soun transparent');
  a('Flat Rice Noodle / Koay Teow (raw)', 100, 191, 3.7, 42, 0.5, 'koay teow flat rice noodle kway teow fresh raw');
  a('Flat Rice Noodle (cooked)', 200, 96, 1.9, 21, 0.3, 'koay teow flat rice noodle cooked plain');
  a('Vermicelli / Bihun (dry)', 50, 360, 6, 79, 1, 'bihun vermicelli rice thin noodle dry uncooked');
  a('Bee Hoon / Rice Stick (cooked)', 200, 110, 2.5, 25, 0.5, 'bee hoon rice stick noodle cooked plain bihun boiled');
  a('Wonton Noodle (raw)', 100, 300, 10, 60, 2.5, 'wonton noodle raw fresh springy wan tan mee');
  a('Spaghetti (cooked)', 200, 158, 5.8, 30.9, 0.9, 'spaghetti pasta cooked al dente italian');
  a('Penne (cooked)', 200, 158, 5.8, 30.9, 0.9, 'penne pasta cooked italian western');
  a('Quinoa (cooked)', 185, 120, 4.4, 21.3, 1.9, 'quinoa cooked grain protein complete whole grain healthy');
  a('Brown Rice (cooked)', 200, 123, 2.6, 25.6, 0.9, 'brown rice nasi perang cooked whole grain healthy');
  a('Oatmeal / Rolled Oats (cooked, water)', 240, 71, 2.5, 12, 1.5, 'oatmeal rolled oats cooked water plain porridge breakfast');
  a('Instant Oat (cooked)', 240, 68, 2.4, 12, 1.3, 'instant oat oatmeal quick cook plain breakfast');

  // ── LEGUMES & PROTEIN ─────────────────────────────────────────────────
  a('Red Lentils / Dal Merah (cooked)', 200, 116, 9, 20, 0.4, 'red lentils dal merah cooked soup protein vegetarian');
  a('Chickpeas / Kacang Kuda (cooked)', 164, 164, 8.9, 27.4, 2.6, 'chickpeas kacang kuda garbanzo cooked hummus curry protein');
  a('Black-Eyed Peas (cooked)', 170, 130, 8.7, 23.5, 0.5, 'black eyed peas kacang cooked protein legume');
  a('Soybeans / Kacang Soya (cooked)', 172, 173, 16.6, 9.9, 9, 'soybean kacang soya cooked protein legume tofu');
  a('Firm Tofu / Tauhu Keras (raw)', 126, 76, 8.1, 1.9, 4.2, 'tauhu keras firm tofu raw protein soy vegetarian');
  a('Silken Tofu / Tauhu Lembut', 150, 55, 5.3, 2, 2.7, 'tauhu lembut silken soft tofu steamed healthy protein');
  a('Tempeh (raw/steamed)', 100, 193, 20.3, 7.6, 10.8, 'tempeh raw steamed soy fermented high protein vegetarian');
  a('Taufu Fa / Tau Huay (soft tofu dessert)', 200, 35, 3, 4, 1, 'taufu fa tau huay tau foo fah soft tofu dessert sweet ginger');
  a('Taupok / Deep Fried Tofu', 30, 270, 18, 5.5, 21, 'taupok deep fried tofu hollow light stir fry soup');
  a('Dried Tofu / Tauhu Pok Kering', 40, 158, 17, 2.5, 9, 'tauhu kering dried tofu cooked yong tau foo');

  // ── HEALTH & PROTEIN FOODS ────────────────────────────────────────────
  a('Protein Bar (generic ~60g)', 60, 375, 25, 42, 8, 'protein bar snack high protein bar generic workout gym');
  a('Protein Shake (whey, 1 scoop 30g in water)', 330, 105, 24, 3, 1.5, 'whey protein shake 1 scoop powder water supplement gym');
  a('Chia Seed (1 tbsp)', 12, 486, 16.5, 42.1, 30.7, 'chia seed 1 tbsp tablespoon superfood omega');
  a('Flaxseed / Biji Rami (1 tbsp)', 10, 534, 18.3, 28.9, 42.2, 'flaxseed biji rami 1 tbsp omega healthy fat');
  a('Pumpkin Seeds / Biji Labu (per 30g)', 30, 570, 30, 11, 49, 'pumpkin seeds biji labu 30g snack healthy protein omega');
  a('Sunflower Seeds / Biji Bunga Matahari (per 30g)', 30, 584, 20.8, 20, 51.5, 'sunflower seeds 30g snack healthy protein omega');
  a('Mixed Nuts (per 30g)', 30, 600, 16, 14, 55, 'mixed nuts 30g cashew almond walnut snack healthy');
  a('Dark Chocolate 70% (per square)', 10, 598, 7.8, 46, 43, '70% dark chocolate square bar healthy antioxidant');
  a('Honey (1 tsp)', 7, 304, 0.3, 82.4, 0, 'honey madu 1 tsp teaspoon natural sweetener');
  a('Coconut Sugar (1 tsp)', 5, 375, 0, 100, 0, 'coconut sugar gula kelapa 1 tsp natural sweetener');
  a('Gula Melaka / Palm Sugar (1 tbsp)', 15, 380, 0.5, 93, 0.3, 'gula melaka palm sugar 1 tbsp natural sweet malaysian traditional');

  // ── COMMON MILKS & DAIRY DRINKS (human glass servings) ──────────────
  // m(name, cal/100ml, p, c, f, tags, brand) — default 250ml glass + box sizes
  const m = (n, cal, p, c, f, tg, br) => F.push({
    name: n, serving: 250, cal, p, c, f, tags: tg || '', brand: br || '',
    servings: [{ n: '1 glass (250ml)', g: 250 }, { n: '1 cup (200ml)', g: 200 },
               { n: '1 small box (125ml)', g: 125 }, { n: '100ml', g: 100 }]
  });
  m('HL Low Fat Milk', 47, 3.6, 5, 1.2, 'hl milk low fat low lactose dutch lady marigold susu rendah lemak', 'Marigold HL');
  m('Full Cream Milk (fresh)', 64, 3.2, 4.8, 3.6, 'full cream milk fresh susu penuh whole milk', '');
  m('Low Fat Milk (fresh)', 47, 3.4, 5, 1.5, 'low fat milk fresh susu rendah lemak skim', '');
  m('Skim / Non-Fat Milk', 35, 3.4, 5, 0.1, 'skim milk non fat fat free skimmed susu tanpa lemak', '');
  m('Farm Fresh Full Cream Milk', 65, 3.3, 4.8, 3.7, 'farm fresh full cream milk fresh susu', 'Farm Fresh');
  m('Farm Fresh Low Fat Milk', 46, 3.4, 5, 1.3, 'farm fresh low fat milk fresh susu', 'Farm Fresh');
  m('Dutch Lady Full Cream Milk', 64, 3.2, 4.9, 3.5, 'dutch lady full cream milk susu', 'Dutch Lady');
  m('Dutch Lady Low Fat Milk', 46, 3.4, 5.1, 1.3, 'dutch lady low fat milk susu', 'Dutch Lady');
  m('Goodday Full Cream Milk', 64, 3.2, 4.8, 3.6, 'good day goodday full cream milk susu', 'Goodday');
  m('Goodday Chocolate Milk', 74, 3, 12, 1.6, 'good day goodday chocolate milk susu coklat', 'Goodday');
  m('Marigold UHT Full Cream', 64, 3.2, 4.8, 3.6, 'marigold uht full cream milk susu', 'Marigold');
  m('Magnolia Low Fat Milk', 46, 3.4, 5, 1.3, 'magnolia low fat milk susu f&n', 'Magnolia');
  m('Soy Milk (unsweetened)', 33, 3.3, 1.8, 1.8, 'soy milk soya susu soya unsweetened plain vsoy', '');
  m('Soy Milk (sweetened)', 54, 3, 6.5, 1.8, 'soy milk soya susu soya sweetened vsoy yeo', '');
  m('Vsoy Soy Milk', 56, 3.5, 6.8, 1.7, 'vsoy soy milk soya protein susu', 'Vsoy');
  m('Oat Milk (barista)', 59, 1, 9, 1.5, 'oat milk barista plant based susu oat', '');
  m('Almond Milk (unsweetened)', 15, 0.5, 0.6, 1.2, 'almond milk unsweetened plant based susu badam', '');
  m('Fresh Milk (Greenfields)', 61, 3.2, 4.6, 3.3, 'greenfields fresh milk full cream susu', 'Greenfields');
  m('Evaporated Milk (F&N, per 100ml)', 134, 6.7, 10, 7.6, 'evaporated milk susu cair f&n carnation teh tarik', 'F&N');
  m('Condensed Milk (sweetened, per 100ml)', 321, 7.9, 54, 8.7, 'condensed milk susu pekat manis sweetened teh tarik kopi', '');

  console.log('[DevFit] foods-bulk.js loaded — added ' +
    (F.length) + ' total foods now in local DB.');
})();
