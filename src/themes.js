// The seven content categories of the master prompt and the illustrated scenes a post can use.
// Categories rotate across runs; the writer chooses the topic inside a category and one fitting scene.

export const CATEGORIES = [
  {
    id: "past",
    name: "Past aur Memories",
    topics: [
      "purani yaadein aur bachpan",
      "woh decisions jin par aaj bhi regret hota hai",
      "purane dost aur badalte rishte",
      "woh waqt jab hum zyada carefree the",
      "past ko accept karke present mein jeena",
    ],
    scenes: ["dusk_window", "old_letters", "autumn_road"],
  },
  {
    id: "love",
    name: "Love aur Relationships",
    topics: [
      "kisi ko miss karna jo ab life mein nahi hai",
      "unspoken feelings aur adhuri baatein",
      "emotional distance aur badalte rishte",
      "trust, attachment, heartbreak aur closure",
      "insaan ko nahi, uske saath bitaye waqt ko miss karna",
      "pyaar mein self-respect aur emotional maturity",
    ],
    scenes: ["rain_window", "two_cups", "dusk_window"],
  },
  {
    id: "family",
    name: "Family aur Parents",
    topics: [
      "parents ki sacrifices jo bade hone ke baad samajh aati hain",
      "family expectations aur responsibilities",
      "parents aur bachchon ke beech generation gap",
      "family ke liye apne sapne chhod dena",
      "woh baatein jo family ke saamne keh nahi paate",
      "apno se pyaar karte hue healthy boundaries",
    ],
    scenes: ["kitchen_lamp", "doorway_light", "two_cups"],
  },
  {
    id: "work",
    name: "Work, Career aur Ambition",
    topics: [
      "mehnat ke baad bhi recognition na milna",
      "office politics aur workplace disappointment",
      "financial responsibilities aur apne sapne",
      "success ke bawajood andar ka sukoon na hona",
      "hamesha strong aur capable dikhne ka pressure",
      "success, failure aur self-worth ka farq",
    ],
    scenes: ["office_night", "city_commute", "rain_window"],
  },
  {
    id: "friendship",
    name: "Friendship aur Loneliness",
    topics: [
      "purani dosti ka dheere-dheere khatam hona",
      "logon ke beech rehkar bhi akela mehsoos karna",
      "zindagi ke saath priorities ka badalna",
      "trust karna aur disappointment",
      "un logon ko accept karna jo ab pehle jaise nahi rahe",
    ],
    scenes: ["railway_platform", "streetlight", "two_cups"],
  },
  {
    id: "healing",
    name: "Self-Respect aur Healing",
    topics: [
      "apni purani galtiyon ko maaf karna",
      "har baat ka jawab ya maafi na milna",
      "kisi situation ko accept karke aage badhna",
      "apni boundaries samajhna",
      "sabko khush karte-karte khud ko na bhoolna",
      "apni pehchaan aur sukoon dobara dhoondhna",
    ],
    scenes: ["sunrise_path", "new_leaves", "doorway_light"],
  },
  {
    id: "life",
    name: "Life aur Philosophy",
    topics: [
      "waqt aur badalti zindagi",
      "expectations aur reality ka farq",
      "khushi, success aur andar ka sukoon",
      "insaan ka badalna aur maturity",
      "mushkil daur se seekhna",
      "woh sach jo umar aur tajurbe ke saath samajh aate hain",
    ],
    scenes: ["autumn_road", "sunrise_path", "streetlight"],
  },
];

export const SCENES = {
  dusk_window: "Shaam ki khidki: suraj doob chuka, pehla taara, khidki par thandi chai",
  rain_window: "Baarish wali khidki: sheeshe par boondein, dhundhli city lights",
  two_cups: "Ek table par do cups, ek khaali kursi, halki lamp ki roshni",
  old_letters: "Purani chitthiyan aur ek photo, peeli roshni",
  autumn_road: "Patjhad ki sadak, girte patte, lambi parchhaiyan",
  kitchen_lamp: "Raat ki rasoi: ek bulb, chulhe par bartan, garam peeli roshni",
  doorway_light: "Adhkhula darwaza jisse garam roshni bahar aa rahi hai",
  office_night: "Raat ka khaali office: ek desk lamp, khidki ke bahar city lights",
  city_commute: "Shaam ki local train/bus window se guzarti city",
  railway_platform: "Khaali railway platform, ek bench, door jaati patriyan",
  streetlight: "Sunsaan gali mein ek streetlight aur akeli parchhai",
  sunrise_path: "Subah ka raasta, ugta suraj, halki dhund",
  new_leaves: "Sukhi daal par nayi hari pattiyan, subah ki roshni",
};

/**
 * Categories for this run: the ones used least recently go first, and one run never repeats a category.
 * `recent` is the history newest-first.
 */
export function pickCategories(count, recent, random = Math.random) {
  const lastUsed = new Map();
  recent.forEach((post, index) => {
    if (!lastUsed.has(post.category)) lastUsed.set(post.category, index);
  });
  return [...CATEGORIES]
    .map(category => ({ category, age: lastUsed.has(category.id) ? lastUsed.get(category.id) : Infinity, tie: random() }))
    .sort((a, b) => b.age - a.age || a.tie - b.tie)
    .slice(0, count)
    .map(entry => entry.category);
}
