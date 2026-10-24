// Bollywood songs suggested in the caption ("Is kavita ke saath suniye: …"). Only the song's name, film and
// year are printed; the song itself is never used in a post. The list is hand-checked: the writer picks a
// song by id from it and never names a song from memory, so a wrong film or year cannot slip in.
//
// Moods: udaas (yaadein, dard, akelapan) · pyaar · ghar (family, maa-baap) · josh (kaam, himmat)
//        dosti · soch (zindagi, falsafa)

export const MOODS = ["udaas", "pyaar", "ghar", "josh", "dosti", "soch"];

// Mood used when a post has none (drafts written before moods existed).
export const CATEGORY_MOOD = { past: "udaas", love: "pyaar", family: "ghar", work: "josh", friendship: "dosti", healing: "soch", life: "soch" };

const S = (id, title, film, year, moods) => ({ id, title, film, year, moods });

export const SONGS = [
  S("kahin-door", "Kahin Door Jab Din Dhal Jaaye", "Anand", 1971, ["udaas", "soch"]),
  S("tere-bina-zindagi", "Tere Bina Zindagi Se Koi", "Aandhi", 1975, ["udaas", "pyaar"]),
  S("dil-dhoondta-hai", "Dil Dhoondta Hai", "Mausam", 1975, ["udaas", "soch"]),
  S("waqt-ne-kiya", "Waqt Ne Kiya Kya Haseen Sitam", "Kaagaz Ke Phool", 1959, ["udaas", "pyaar"]),
  S("chingari-koi", "Chingari Koi Bhadke", "Amar Prem", 1972, ["udaas", "soch"]),
  S("tum-itna-jo", "Tum Itna Jo Muskura Rahe Ho", "Arth", 1982, ["udaas"]),
  S("channa-mereya", "Channa Mereya", "Ae Dil Hai Mushkil", 2016, ["udaas", "pyaar"]),
  S("agar-tum-saath-ho", "Agar Tum Saath Ho", "Tamasha", 2015, ["udaas", "pyaar"]),
  S("tanhayee", "Tanhayee", "Dil Chahta Hai", 2001, ["udaas", "dosti"]),
  S("abhi-mujh-mein", "Abhi Mujh Mein Kahin", "Agneepath", 2012, ["udaas", "ghar"]),
  S("phir-le-aaya-dil", "Phir Le Aaya Dil", "Barfi!", 2012, ["udaas", "pyaar"]),
  S("kabhi-alvida", "Kabhi Alvida Naa Kehna", "Kabhi Alvida Naa Kehna", 2006, ["udaas", "pyaar"]),
  S("tujhse-naraz", "Tujhse Naraz Nahi Zindagi", "Masoom", 1983, ["udaas", "soch", "ghar"]),

  S("lag-jaa-gale", "Lag Jaa Gale", "Woh Kaun Thi?", 1964, ["pyaar", "udaas"]),
  S("kabhi-kabhi", "Kabhi Kabhi Mere Dil Mein", "Kabhi Kabhie", 1976, ["pyaar"]),
  S("tujh-mein-rab", "Tujh Mein Rab Dikhta Hai", "Rab Ne Bana Di Jodi", 2008, ["pyaar"]),
  S("tum-hi-ho", "Tum Hi Ho", "Aashiqui 2", 2013, ["pyaar"]),
  S("pehla-nasha", "Pehla Nasha", "Jo Jeeta Wohi Sikandar", 1992, ["pyaar"]),
  S("tere-mere-sapne", "Tere Mere Sapne Ab Ek Rang Hain", "Guide", 1965, ["pyaar"]),
  S("ek-pyar-ka-nagma", "Ek Pyar Ka Nagma Hai", "Shor", 1972, ["pyaar", "soch"]),
  S("hothon-se-chhu-lo", "Hothon Se Chhu Lo Tum", "Prem Geet", 1981, ["pyaar"]),
  S("tum-se-hi", "Tum Se Hi", "Jab We Met", 2007, ["pyaar"]),

  S("papa-kehte-hain", "Papa Kehte Hain", "Qayamat Se Qayamat Tak", 1988, ["ghar", "josh"]),
  S("maa", "Maa", "Taare Zameen Par", 2007, ["ghar"]),
  S("luka-chuppi", "Luka Chuppi", "Rang De Basanti", 2006, ["ghar", "udaas"]),
  S("chitthi-aayi-hai", "Chitthi Aayi Hai", "Naam", 1986, ["ghar", "udaas"]),
  S("tu-kitni-achhi", "Tu Kitni Achhi Hai", "Raja Aur Runk", 1968, ["ghar"]),
  S("ghar-se-nikalte-hi", "Ghar Se Nikalte Hi", "Papa Kehte Hain", 1996, ["pyaar", "ghar"]),
  S("babul-ki-duaayen", "Babul Ki Duaayen Leti Ja", "Neel Kamal", 1968, ["ghar"]),
  S("yeh-jo-des", "Yeh Jo Des Hai Tera", "Swades", 2004, ["ghar", "soch"]),

  S("ruk-jana-nahin", "Ruk Jana Nahin", "Imtihan", 1974, ["josh", "soch"]),
  S("zinda", "Zinda", "Bhaag Milkha Bhaag", 2013, ["josh"]),
  S("kar-har-maidaan", "Kar Har Maidaan Fateh", "Sanju", 2018, ["josh"]),
  S("lakshya", "Lakshya", "Lakshya", 2004, ["josh"]),
  S("aashayein", "Aashayein", "Iqbal", 2005, ["josh", "soch"]),
  S("chak-de", "Chak De! India", "Chak De! India", 2007, ["josh", "dosti"]),
  S("phir-se-ud-chala", "Phir Se Ud Chala", "Rockstar", 2011, ["josh", "soch"]),

  S("yeh-dosti", "Yeh Dosti Hum Nahin Todenge", "Sholay", 1975, ["dosti"]),
  S("tere-jaisa-yaar", "Tere Jaisa Yaar Kahan", "Yaarana", 1981, ["dosti"]),
  S("jaane-nahin-denge", "Jaane Nahin Denge Tujhe", "3 Idiots", 2009, ["dosti", "udaas"]),
  S("dil-chahta-hai", "Dil Chahta Hai", "Dil Chahta Hai", 2001, ["dosti"]),
  S("behti-hawa-sa", "Behti Hawa Sa Tha Woh", "3 Idiots", 2009, ["dosti", "soch"]),

  S("zindagi-kaisi-hai", "Zindagi Kaisi Hai Paheli", "Anand", 1971, ["soch"]),
  S("musafir-hoon", "Musafir Hoon Yaaron", "Parichay", 1972, ["soch", "dosti"]),
  S("main-zindagi-ka", "Main Zindagi Ka Saath Nibhata Chala Gaya", "Hum Dono", 1961, ["soch", "josh"]),
  S("aanewala-pal", "Aanewala Pal Janewala Hai", "Gol Maal", 1979, ["soch", "pyaar"]),
  S("zindagi-ke-safar", "Zindagi Ke Safar Mein Guzar Jaate Hain", "Aap Ki Kasam", 1974, ["soch", "udaas"]),
  S("ae-zindagi", "Ae Zindagi Gale Laga Le", "Sadma", 1983, ["soch", "josh"]),
  S("ilahi", "Ilahi", "Yeh Jawaani Hai Deewani", 2013, ["soch", "dosti"]),
  S("kabira", "Kabira", "Yeh Jawaani Hai Deewani", 2013, ["soch", "pyaar"]),
  S("kun-faya-kun", "Kun Faya Kun", "Rockstar", 2011, ["soch"]),
  S("aaj-phir-jeene", "Aaj Phir Jeene Ki Tamanna Hai", "Guide", 1965, ["soch", "josh"]),
  S("kal-ho-naa-ho", "Kal Ho Naa Ho", "Kal Ho Naa Ho", 2003, ["soch", "dosti"]),
];

export const songById = id => SONGS.find(s => s.id === id) || null;

/** Songs for a mood, those used in the last `recent` posts last. */
export function songsFor(mood, recent = []) {
  const used = new Set(recent.slice(0, 15).map(p => p.song?.id).filter(Boolean));
  const fit = SONGS.filter(s => s.moods.includes(mood));
  return [...fit.filter(s => !used.has(s.id)), ...fit.filter(s => used.has(s.id))];
}

export const songLine = song => (song ? `Is kavita ke saath suniye: "${song.title}" — ${song.film} (${song.year})` : "");
