// Illustrated backgrounds (inline SVG, 1080×1350) for the cover slide. Each scene keeps its upper part
// (y ≈ 150–820) calm for text and puts the storytelling detail lower down. `tone` says whether text on it
// is light or dark; `paper` is the matching palette for the text slides that follow the cover.

const W = 1080;
const H = 1350;

/** Deterministic pseudo-random numbers so a post re-renders identically. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const grad = (id, stops, { x2 = 0, y2 = 1 } = {}) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
const radial = (id, color, a = 0.6) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;

function stars(rand, n, { yMax = 760, color = "#fff8ea" } = {}) {
  let out = "";
  for (let i = 0; i < n; i++) out += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(40 + rand() * yMax).toFixed(0)}" r="${(0.8 + rand() * 1.6).toFixed(1)}" fill="${color}" opacity="${(0.35 + rand() * 0.6).toFixed(2)}"/>`;
  return out;
}

const cup = (x, y, fill, steam = "") =>
  `<g transform="translate(${x},${y})" fill="${fill}"><path d="M0 0 H86 L78 52 Q76 62 66 62 H20 Q10 62 8 52 Z"/><path d="M84 12 Q112 14 108 34 Q104 50 80 46" fill="none" stroke="${fill}" stroke-width="8"/><ellipse cx="43" cy="64" rx="58" ry="6"/>${
    steam ? `<g fill="none" stroke="${steam}" stroke-width="4" stroke-linecap="round" opacity=".45"><path d="M30 -12 q-14 -26 0 -50 q14 -24 0 -50"/><path d="M56 -16 q-12 -22 0 -42 q12 -20 0 -40"/></g>` : ""
  }</g>`;

const DARK_PAPER = { bg: "#f1e8d9", bg2: "#e3d4bc", ink: "#2b2230", accent: "#8a4a32", muted: "#7a5f4c", rule: "#c9b394" };

const SCENE = {
  dusk_window(rand) {
    return {
      tone: "light",
      accent: "#f0c79c",
      paper: DARK_PAPER,
      svg: `<defs>${grad("sky", [[0, "#141833"], [0.34, "#232848"], [0.58, "#463c5e"], [0.76, "#8a5a63"], [0.88, "#d88b5a"], [0.93, "#f0b27a"]])}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>${stars(rand, 26)}
<g transform="translate(830,700)"><circle r="3.4" fill="#fffaf0"/><circle r="22" fill="#fff3d6" opacity=".08"/></g>
<path d="M0 1130 V1092 H60 V1070 H120 V1098 H190 L210 1060 L230 1098 H300 V1080 H380 V1104 H470 Q520 1060 570 1104 H660 V1072 H700 V1050 H716 V1072 H760 V1100 H860 L880 1076 L900 1100 H1000 V1084 H1080 V1130 Z" fill="#2a2235" opacity=".9"/>
<rect y="1124" width="${W}" height="14" fill="#2b2230"/><rect y="1136" width="${W}" height="${H - 1136}" fill="#1a1522"/>
${cup(250, 1074, "#120e18")}
<rect width="${W}" height="30" fill="#120e18"/><rect width="30" height="1138" fill="#120e18"/><rect x="${W - 30}" width="30" height="1138" fill="#120e18"/>`,
    };
  },

  rain_window(rand) {
    let lights = "";
    const colors = ["#f2b46b", "#e8875a", "#f6d58e", "#9fb7d9", "#e46d6d"];
    for (let i = 0; i < 26; i++) lights += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(880 + rand() * 360).toFixed(0)}" r="${(18 + rand() * 46).toFixed(0)}" fill="${colors[i % colors.length]}" opacity="${(0.18 + rand() * 0.3).toFixed(2)}"/>`;
    let drops = "";
    for (let i = 0; i < 140; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = 2 + rand() * 5;
      drops += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(r * 0.8).toFixed(1)}" ry="${r.toFixed(1)}" fill="#dfe7f2" opacity="${(0.12 + rand() * 0.25).toFixed(2)}"/>`;
      if (rand() < 0.18) drops += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(rand() * 6 - 3).toFixed(0)} ${(40 + rand() * 90).toFixed(0)} 0 ${(60 + rand() * 120).toFixed(0)}" stroke="#dfe7f2" stroke-width="${(1 + rand() * 2).toFixed(1)}" opacity=".18" fill="none"/>`;
    }
    return {
      tone: "light",
      accent: "#f2c48d",
      paper: { ...DARK_PAPER, bg: "#e9ecef", bg2: "#d6dbe1", ink: "#1f2733", accent: "#9a5b3c", muted: "#5d6672", rule: "#b8c0ca" },
      svg: `<defs>${grad("sky", [[0, "#1d2431"], [0.55, "#3a4556"], [1, "#5b5a62"]])}<filter id="blur"><feGaussianBlur stdDeviation="18"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/><g filter="url(#blur)">${lights}</g>${drops}
<rect x="${W - 190}" y="856" width="18" height="${H - 856}" fill="#151a23" opacity=".9"/><rect y="840" width="${W}" height="16" fill="#151a23" opacity=".9"/>`,
    };
  },

  two_cups() {
    return {
      tone: "light",
      accent: "#f1c27d",
      paper: DARK_PAPER,
      svg: `<defs>${grad("wall", [[0, "#2b1f1a"], [0.6, "#4a3428"], [1, "#5d4231"]])}${radial("lamp", "#ffcf8a", 0.55)}</defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/><circle cx="880" cy="860" r="520" fill="url(#lamp)"/>
<g fill="#1c130f"><path d="M860 640 h120 l40 120 h-200 z" fill="#3a2a20"/><rect x="915" y="760" width="10" height="290"/><ellipse cx="920" cy="1050" rx="70" ry="10"/></g>
<rect y="1060" width="${W}" height="${H - 1060}" fill="#21160f"/><rect y="1056" width="${W}" height="10" fill="#3a2a20"/>
${cup(250, 994, "#120c09", "#f6e2c2")}${cup(470, 994, "#120c09")}
<g fill="#140d0a" opacity=".95"><rect x="700" y="870" width="16" height="480"/><rect x="890" y="870" width="16" height="480"/><rect x="700" y="870" width="206" height="18"/><rect x="700" y="940" width="206" height="12"/></g>`,
    };
  },

  old_letters(rand) {
    let letters = "";
    const tilt = [-9, 6, -3, 11];
    tilt.forEach((t, i) => {
      const x = 120 + i * 210 + rand() * 30;
      const y = 930 + rand() * 120;
      letters += `<g transform="translate(${x.toFixed(0)},${y.toFixed(0)}) rotate(${t})"><rect width="300" height="190" rx="4" fill="${["#f6eedd", "#efe2c8", "#f3e7d1", "#eadbbd"][i]}" stroke="#b49a76" stroke-width="2"/><path d="M0 0 L150 105 L300 0" fill="none" stroke="#b49a76" stroke-width="2"/><rect x="232" y="18" width="46" height="56" fill="none" stroke="#a5503a" stroke-width="3" stroke-dasharray="5 4"/></g>`;
    });
    return {
      tone: "dark",
      accent: "#8a4a32",
      paper: { bg: "#f4ecdc", bg2: "#e6d5b8", ink: "#33261c", accent: "#8a4a32", muted: "#7d6450", rule: "#cdb593" },
      svg: `<defs>${grad("bg", [[0, "#f3e8d3"], [0.7, "#e5d1ad"], [1, "#d3b98d"]])}${radial("glow", "#fff6df", 0.8)}</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><circle cx="300" cy="200" r="620" fill="url(#glow)"/>
<g transform="translate(700,820) rotate(-5)"><rect width="260" height="210" fill="#fbf7ee" stroke="#c7b08c" stroke-width="2"/><rect x="18" y="18" width="224" height="150" fill="#9c8a74" opacity=".55"/><circle cx="96" cy="78" r="26" fill="#6e5e4c" opacity=".6"/><path d="M60 168 q36 -60 72 0 z M140 168 q30 -48 60 0z" fill="#6e5e4c" opacity=".6"/></g>
${letters}`,
    };
  },

  autumn_road(rand) {
    let leaves = "";
    const colors = ["#c4622d", "#d98a3a", "#a8432a", "#e0a54b"];
    for (let i = 0; i < 38; i++) {
      const x = rand() * W;
      const y = 860 + rand() * 480;
      leaves += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(7 + rand() * 7).toFixed(0)}" ry="${(3 + rand() * 4).toFixed(0)}" transform="rotate(${(rand() * 180).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${colors[i % 4]}" opacity="${(0.55 + rand() * 0.4).toFixed(2)}"/>`;
    }
    return {
      tone: "dark",
      accent: "#9a3f22",
      paper: { bg: "#f5e9d6", bg2: "#ecd3b0", ink: "#3a2418", accent: "#9a3f22", muted: "#7b5a43", rule: "#d2ae86" },
      svg: `<defs>${grad("sky", [[0, "#f6e3c6"], [0.6, "#efc79a"], [1, "#e4a874"]])}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<path d="M0 960 Q270 900 540 950 T1080 930 V${H} H0Z" fill="#c98b5a" opacity=".55"/>
<path d="M500 960 L580 960 L900 ${H} L180 ${H} Z" fill="#7e5a45"/><path d="M536 980 L544 980 L560 1060 L548 1060Z M552 1110 L566 1110 L590 1230 L570 1230Z" fill="#e9d2a8" opacity=".8"/>
<g fill="#4a2c1f"><rect x="120" y="900" width="22" height="200"/><circle cx="131" cy="900" r="70" fill="#a8562c" opacity=".9"/><rect x="900" y="890" width="26" height="240"/><circle cx="913" cy="880" r="56" fill="#b8642f" opacity=".9"/><rect x="330" y="920" width="12" height="80"/><circle cx="336" cy="912" r="34" fill="#c27a3c" opacity=".85"/></g>
${leaves}`,
    };
  },

  kitchen_lamp() {
    return {
      tone: "light",
      accent: "#f3c27a",
      paper: DARK_PAPER,
      svg: `<defs>${grad("wall", [[0, "#1d1612"], [1, "#3d2c20"]])}${radial("bulb", "#ffd28f", 0.6)}</defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/><rect x="60" width="3" height="900" fill="#0f0b08"/><circle cx="61" cy="930" r="440" fill="url(#bulb)"/>
<path d="M32 880 h58 l-8 24 h-42z" fill="#0f0b08"/><circle cx="61" cy="918" r="15" fill="#fff1cf"/>
<rect y="1120" width="${W}" height="${H - 1120}" fill="#18110c"/><rect y="1112" width="${W}" height="12" fill="#4a3627"/>
<g fill="#100b08"><path d="M560 1030 h190 v70 q0 14 -14 14 h-162 q-14 0 -14 -14z"/><rect x="540" y="1022" width="230" height="14" rx="6"/><path d="M820 1060 q40 -60 100 -50 q46 10 40 60 v44 h-140z"/><path d="M960 1060 q50 -14 70 -50" stroke="#100b08" stroke-width="10" fill="none"/></g>
<g fill="none" stroke="#f6e0bf" stroke-width="4" stroke-linecap="round" opacity=".4"><path d="M620 1010 q-16 -40 0 -80 q16 -40 0 -80"/><path d="M680 1010 q-14 -34 0 -68 q14 -34 0 -68"/></g>`,
    };
  },

  doorway_light() {
    return {
      tone: "light",
      accent: "#f2c27c",
      paper: DARK_PAPER,
      svg: `<defs>${grad("wall", [[0, "#15131b"], [1, "#24202b"]])}${grad("spill", [[0, "#ffd79a", 0.55], [1, "#ffd79a", 0]])}${radial("halo", "#ffcf8a", 0.35)}</defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/><circle cx="560" cy="1000" r="430" fill="url(#halo)"/>
<rect x="470" y="760" width="180" height="420" fill="#ffdca6"/><rect x="470" y="760" width="62" height="420" fill="#2a2230" opacity=".95"/>
<path d="M532 1180 L650 1180 L860 ${H} L520 ${H} Z" fill="url(#spill)"/>
<rect x="452" y="742" width="216" height="18" fill="#0e0c12"/><rect x="452" y="742" width="18" height="438" fill="#0e0c12"/><rect x="650" y="742" width="18" height="438" fill="#0e0c12"/>
<rect y="1180" width="${W}" height="${H - 1180}" fill="#0f0d13" opacity=".6"/>`,
    };
  },

  office_night(rand) {
    let windows = "";
    for (let b = 0; b < 7; b++) {
      const x = b * 160 - 20;
      const top = 820 + rand() * 160;
      windows += `<rect x="${x}" y="${top.toFixed(0)}" width="140" height="${(1150 - top).toFixed(0)}" fill="#141d30"/>`;
      for (let r = top + 20; r < 1120; r += 34) for (let c = 0; c < 4; c++) if (rand() < 0.38) windows += `<rect x="${x + 14 + c * 31}" y="${r.toFixed(0)}" width="18" height="14" fill="#f3cf7d" opacity="${(0.35 + rand() * 0.5).toFixed(2)}"/>`;
    }
    return {
      tone: "light",
      accent: "#9ec3f0",
      paper: { ...DARK_PAPER, bg: "#e8ebf0", bg2: "#d3d9e3", ink: "#18202e", accent: "#2f5d8a", muted: "#556275", rule: "#b6c0cf" },
      svg: `<defs>${grad("sky", [[0, "#0b1120"], [0.6, "#16223a"], [1, "#25324d"]])}${radial("lamp", "#ffe2a6", 0.5)}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>${stars(rand, 10, { yMax: 600 })}${windows}
<rect y="1150" width="${W}" height="${H - 1150}" fill="#0a0e17"/><rect y="1146" width="${W}" height="8" fill="#2a3550"/>
<circle cx="760" cy="1150" r="260" fill="url(#lamp)"/>
<g fill="#06090f"><path d="M700 1146 l40 -150 l8 3 l-34 147z"/><path d="M712 990 l90 -30 l14 40 l-96 18z"/><rect x="300" y="1060" width="250" height="90" rx="6"/><rect x="270" y="1144" width="310" height="10" rx="4"/></g>`,
    };
  },

  city_commute(rand) {
    let streaks = "";
    const colors = ["#ffb36b", "#ffd38a", "#ff7f6b", "#8fb6ff"];
    for (let i = 0; i < 22; i++) {
      const y = 860 + rand() * 260;
      const x = rand() * W;
      streaks += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(120 + rand() * 300).toFixed(0)}" height="${(3 + rand() * 7).toFixed(0)}" rx="4" fill="${colors[i % 4]}" opacity="${(0.25 + rand() * 0.5).toFixed(2)}"/>`;
    }
    return {
      tone: "light",
      accent: "#ffc48a",
      paper: DARK_PAPER,
      svg: `<defs>${grad("sky", [[0, "#1d1631"], [0.55, "#4a2f55"], [0.85, "#a4566a"], [1, "#d9806b"]])}<filter id="mb"><feGaussianBlur stdDeviation="3 0"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/><g filter="url(#mb)">${streaks}</g>
<path d="M0 0 H${W} V${H} H0Z M70 90 Q70 60 100 60 H980 Q1010 60 1010 90 V1170 Q1010 1200 980 1200 H100 Q70 1200 70 1170Z" fill="#0e0b14" fill-rule="evenodd"/>
<rect x="70" y="1240" width="940" height="14" rx="7" fill="#2b2433"/>`,
    };
  },

  railway_platform() {
    return {
      tone: "dark",
      accent: "#3d5872",
      paper: { bg: "#eef1f4", bg2: "#d9e0e7", ink: "#1d2836", accent: "#3d5872", muted: "#5d6b7a", rule: "#bcc7d2" },
      svg: `<defs>${grad("sky", [[0, "#dfe6ec"], [0.6, "#c4cfd9"], [1, "#a9b6c3"]])}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<path d="M0 900 H${W} V960 H0Z" fill="#9aa8b6" opacity=".6"/>
<path d="M0 ${H} L470 930 L520 930 L260 ${H}Z" fill="#7b8896"/><path d="M560 930 L600 930 L1080 1180 L1080 ${H} L900 ${H}Z" fill="#8f9ba8"/>
<g stroke="#4f5c6a" stroke-width="5"><path d="M330 ${H} L500 930"/><path d="M500 ${H} L512 930"/></g>
<g fill="#3a4654"><rect x="760" y="850" width="12" height="230"/><path d="M730 850 h72 l-10 26 h-52z"/><rect x="820" y="1040" width="210" height="14"/><rect x="830" y="1054" width="10" height="60"/><rect x="1010" y="1054" width="10" height="60"/><rect x="820" y="990" width="210" height="10"/></g>`,
    };
  },

  streetlight() {
    return {
      tone: "light",
      accent: "#f5cf86",
      paper: DARK_PAPER,
      svg: `<defs>${grad("sky", [[0, "#0a0d14"], [1, "#1a1f2b"]])}${grad("cone", [[0, "#ffe3a3", 0.45], [1, "#ffe3a3", 0.02]])}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<path d="M800 880 L600 1230 L1080 1230 L1080 1000Z" fill="url(#cone)"/>
<rect y="1230" width="${W}" height="${H - 1230}" fill="#07090e"/>
<g fill="#05070b"><rect x="930" y="860" width="14" height="370"/><path d="M944 868 q-70 -10 -140 4 l4 14 q66 -12 136 -2z"/><path d="M770 876 h70 l-8 18 h-54z"/></g>
<ellipse cx="805" cy="896" rx="34" ry="8" fill="#fff0c4" opacity=".9"/>
<g fill="#05070b"><circle cx="560" cy="1078" r="16"/><path d="M544 1096 h32 l8 80 l-10 54 h-10 l-4 -48 l-4 48 h-10 l-10 -54z"/></g>
<path d="M550 1230 L300 1290 L330 1296 L578 1230Z" fill="#000" opacity=".5"/>`,
    };
  },

  sunrise_path() {
    return {
      tone: "dark",
      accent: "#a2532a",
      paper: { bg: "#fbf3e3", bg2: "#f2ddb9", ink: "#3b2516", accent: "#a2532a", muted: "#80603f", rule: "#dcbf92" },
      svg: `<defs>${grad("sky", [[0, "#fdf4e2"], [0.55, "#f9dcae"], [0.8, "#f4b77f"], [1, "#e9a06f"]])}${radial("sun", "#fff3cf", 0.9)}</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/><circle cx="540" cy="1000" r="300" fill="url(#sun)"/><circle cx="540" cy="1000" r="82" fill="#fff4d6"/>
<path d="M0 1000 Q300 960 540 990 T1080 980 V${H} H0Z" fill="#c9895c"/>
<path d="M520 1000 L560 1000 L760 ${H} L320 ${H}Z" fill="#f2cf9c"/>
<g fill="#fff" opacity=".35"><rect y="960" width="${W}" height="18"/><rect y="1040" width="${W}" height="10"/></g>
<g fill="#8a5434"><path d="M60 1010 q30 -120 60 0z"/><path d="M930 1000 q40 -160 80 0z"/></g>`,
    };
  },

  new_leaves() {
    const leaf = (x, y, r, s = 1) => `<path transform="translate(${x},${y}) rotate(${r}) scale(${s})" d="M0 0 q40 -36 90 -10 q-40 40 -90 10z" fill="#7aa35a"/><path transform="translate(${x},${y}) rotate(${r}) scale(${s})" d="M0 0 q45 -12 88 -10" stroke="#55803d" stroke-width="2" fill="none"/>`;
    return {
      tone: "dark",
      accent: "#4f7a3a",
      paper: { bg: "#f2f3e8", bg2: "#dfe6cf", ink: "#24301d", accent: "#4f7a3a", muted: "#5f6b52", rule: "#c3cfaa" },
      svg: `<defs>${grad("bg", [[0, "#f6f5ea"], [0.7, "#e4ebd3"], [1, "#cfdcb6"]])}${radial("sun", "#fffbe8", 0.9)}</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><circle cx="200" cy="260" r="520" fill="url(#sun)"/>
<path d="M${W} 1010 Q820 1040 700 1120 T420 1250" stroke="#6b5039" stroke-width="18" fill="none" stroke-linecap="round"/>
<path d="M820 1040 q-40 -70 -20 -150" stroke="#6b5039" stroke-width="9" fill="none" stroke-linecap="round"/>
${leaf(800, 890, -70, 0.9)}${leaf(806, 930, -150, 0.7)}${leaf(700, 1120, -110, 1)}${leaf(600, 1180, -40, 0.8)}${leaf(520, 1222, -130, 0.75)}${leaf(940, 1018, -95, 0.65)}`,
    };
  },
};

export const SCENE_KEYS = Object.keys(SCENE);

/** { svg, tone, accent, paper } for a scene key; unknown keys fall back to the dusk window. */
export function scene(key, seed = 1) {
  const build = SCENE[key] || SCENE.dusk_window;
  const out = build(rng(seed));
  return { ...out, svg: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.svg}</svg>` };
}
