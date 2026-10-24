import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scene } from "./scenes.js";
import { JobError } from "./util.js";

// Carousel slides (1080×1350, 4:5) rendered with Playwright → JPEG.
//   With a classical couplet: 1 cover (scene + Devanagari couplet + attribution), 2 bhavarth, 3 original poem.
//   Original writing only:    1 cover (scene + title + hook), 2 original poem.
// Every label on the image is Hinglish. Text auto-shrinks to fit; if it still overflows the render fails.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SIZE = { width: 1080, height: 1350 };

function fontFace(family, file, weight, style = "normal") {
  const full = path.join(ROOT, "node_modules", file);
  if (!fs.existsSync(full)) return "";
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(full).toString("base64")}) format("woff2");font-weight:${weight};font-style:${style};}`;
}

let fontCss = null;
function fonts() {
  fontCss ??= [
    fontFace("Tiro", "@fontsource/tiro-devanagari-hindi/files/tiro-devanagari-hindi-devanagari-400-normal.woff2", 400),
    fontFace("Tiro", "@fontsource/tiro-devanagari-hindi/files/tiro-devanagari-hindi-latin-400-normal.woff2", 400),
    ...[400, 500].flatMap(w => ["normal", "italic"].map(s => fontFace("Lora", `@fontsource/lora/files/lora-latin-${w}-${s}.woff2`, w, s))),
    ...[400, 500, 600].flatMap(w => ["latin", "devanagari"].map(sub => fontFace("Mukta", `@fontsource/mukta/files/mukta-${sub}-${w}-normal.woff2`, w))),
  ].join("\n");
  return fontCss;
}

const esc = s =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Couplet line as shown: the edition's words, with the trailing verse number dropped ("…खेत॥१८॥" → "…खेत॥"). */
export const displayLine = line => String(line).replace(/॥\s*[०-९0-9]+\s*॥\s*$/, "॥");

/** "Kabir ki sakhi", "Rahim ka doha": the Hinglish name of a verse form with the right gender. */
export function formPhrase(source) {
  const [word, gender] = { "साखी": ["sakhi", "ki"], "सोरठा": ["sortha", "ka"] }[source.form] || ["doha", "ka"];
  return `${source.poet.roman} ${gender} ${word}`;
}

function page({ css, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts()}
*{box-sizing:border-box}html,body{margin:0;width:${SIZE.width}px;height:${SIZE.height}px;overflow:hidden}
.c{position:relative;width:${SIZE.width}px;height:${SIZE.height}px;overflow:hidden}
.bg{position:absolute;inset:0}
.brand{position:absolute;top:70px;left:0;right:0;text-align:center;font:500 24px/1 "Mukta";letter-spacing:.24em}
.brand i{display:block;width:56px;height:1px;margin:22px auto 0}
.count{position:absolute;bottom:60px;right:80px;font:500 20px "Mukta";letter-spacing:.2em;opacity:.7}
.grain{position:absolute;inset:0;pointer-events:none}
${css}</style></head><body><div class="c">${body}
<svg class="grain" width="${SIZE.width}" height="${SIZE.height}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
</div></body></html>`;
}

function coverCss(look) {
  const ink = look.tone === "light" ? "#f7efe3" : look.paper.ink;
  const muted = look.tone === "light" ? "#ddcfbf" : look.paper.muted;
  const shadow = look.tone === "light" ? "0 2px 22px rgba(8,10,20,.55)" : "0 1px 14px rgba(255,250,235,.6)";
  return `.brand{color:${muted}}.brand i{background:${look.accent}}
.grain{opacity:${look.tone === "light" ? 0.12 : 0.16};mix-blend-mode:${look.tone === "light" ? "overlay" : "multiply"}}
.count{color:${muted}}
.zone{position:absolute;top:190px;left:70px;right:70px;height:640px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:${ink};text-shadow:${shadow}}
.doha{font:400 58px/1.55 "Tiro";margin:0;overflow:hidden;max-height:420px;width:100%}
.doha span{display:block;white-space:nowrap}
.hook{font:italic 400 60px/1.34 "Lora";margin:0;max-height:440px;overflow:hidden;width:100%}
.title{font:500 26px "Mukta";letter-spacing:.24em;text-transform:uppercase;color:${look.accent};margin:0 0 34px;text-shadow:none}
.att{margin-top:42px;font:600 30px "Mukta";letter-spacing:.06em;color:${look.accent};text-shadow:none}
.att small{display:block;margin-top:6px;font:400 22px "Mukta";letter-spacing:.04em;color:${muted}}`;
}

function paperCss(p) {
  return `.c{background:radial-gradient(120% 80% at 80% 0%,${p.bg} 0%,${p.bg2} 100%)}
.brand{color:${p.muted}}.brand i{background:${p.accent}}
.grain{opacity:.16;mix-blend-mode:multiply}.count{color:${p.muted}}
.body{position:absolute;top:200px;left:100px;right:90px;bottom:290px;display:flex;flex-direction:column;justify-content:center;color:${p.ink};overflow:hidden}
.kicker{font:600 22px "Mukta";letter-spacing:.22em;text-transform:uppercase;color:${p.accent};margin:0 0 30px}
.poem p{font:400 40px/1.6 "Lora";margin:0;white-space:nowrap}
.poem p.last{font-style:italic;color:${p.accent}}
.poem p.gap{margin-top:30px}
.meaning{font:400 42px/1.55 "Lora";margin:0}
.mini-doha{font:400 34px/1.6 "Tiro";color:${p.muted};margin:0 0 34px}
.label{position:absolute;left:100px;right:100px;bottom:120px;font:600 21px "Mukta";letter-spacing:.1em;text-transform:uppercase;color:${p.muted};border-top:1px solid ${p.rule};padding-top:22px}
.label em.handle{font-style:normal;text-transform:none;letter-spacing:.06em}
.label span{display:block;margin-top:6px;font-weight:400;letter-spacing:.03em;text-transform:none;font-size:22px}`;
}

const brand = name => `<div class="brand">${esc(name)}<i></i></div>`;
const counter = (i, n) => (n > 1 ? `<div class="count">${i}/${n}</div>` : "");

/** Splits poem lines into two stanzas when there are 6+ lines (a pause halfway reads better). */
function poemHtml(lines) {
  const half = lines.length >= 6 ? Math.ceil(lines.length / 2) : -1;
  return lines.map((line, i) => `<p class="${[i === half ? "gap" : "", i === lines.length - 1 ? "last" : ""].join(" ").trim()}">${esc(line)}</p>`).join("");
}

export function buildSlides(post, { brandName, seed = 1 }) {
  const look = scene(post.scene, seed);
  const c = post.couplet;
  const total = c ? 3 : 2;
  const slides = [];

  const coverBody = c
    ? `<div class="zone"><p class="doha fit" data-min="36" data-name="couplet">${c.lines.map(l => `<span>${esc(displayLine(l))}</span>`).join("")}</p>
       <div class="att">— ${esc(c.source.poet.hi)} <small>${esc(c.source.work.roman)} (${c.source.year}) · ${esc(c.source.form)} ${c.number}</small></div></div>`
    : `<div class="zone"><p class="title">${esc(post.title)}</p><p class="hook fit" data-min="40" data-name="hook">${esc(post.hook)}</p></div>`;
  slides.push(page({ css: coverCss(look), body: `<div class="bg">${look.svg}</div>${brand(brandName)}${coverBody}${counter(1, total)}` }));

  if (c) {
    slides.push(
      page({
        css: paperCss(look.paper),
        body: `${brand(brandName)}<div class="body fit" data-min="28" data-name="bhavarth"><div class="kicker">Bhavarth</div>
          <p class="mini-doha">${c.lines.map(l => esc(displayLine(l))).join("<br>")}</p>
          <p class="meaning">${esc(post.bhavarth)}</p></div>
          <div class="label">Bhavarth — hamari samajh<span>Shabdsah anuvaad nahi · Mool: ${esc(c.source.poet.roman)}, ${esc(c.source.work.roman)} (${c.source.year})</span></div>${counter(2, total)}`,
      })
    );
  }

  slides.push(
    page({
      css: paperCss(look.paper),
      body: `${brand(brandName)}<div class="body poem fit" data-min="26" data-name="poem"><div class="kicker">${esc(post.title)}</div>${poemHtml(post.poem)}</div>
        <div class="label">Mool Rachna — <em class="handle">${esc(brandName)}</em><span>${c ? `Prerna: ${esc(formPhrase(c.source))}` : "Is page ki apni rachna"}</span></div>${counter(total, total)}`,
    })
  );
  return { slides, look };
}

// Shrinks every .fit element (and its children) 1px at a time until nothing overflows; returns what still does.
const FIT_SCRIPT = `(() => {
  const over = el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 ||
    [...el.querySelectorAll('span,p')].some(c => c.scrollWidth > c.clientWidth + 1);
  const failed = [];
  for (const el of document.querySelectorAll('.fit')) {
    const min = Number(el.dataset.min || 20);
    const nodes = [el, ...el.querySelectorAll('p,span')];
    let guard = 0;
    while (over(el) && guard++ < 80) {
      let changed = false;
      for (const n of nodes) {
        const size = parseFloat(getComputedStyle(n).fontSize);
        if (size > min) { n.style.fontSize = (size - 1) + 'px'; changed = true; }
      }
      if (!changed) break;
    }
    if (over(el)) failed.push(el.dataset.name || 'text');
  }
  return failed;
})()`;

export async function launchBrowser({ chromiumPath } = {}) {
  const { chromium } = await import("playwright");
  return chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
}

/** Renders `html` to a JPEG at `file`; fails if any text block still overflows after shrinking. */
export async function renderJpeg(browser, { html, file }) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  try {
    const tab = await context.newPage();
    await tab.setContent(html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    const overflow = await tab.evaluate(FIT_SCRIPT);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (overflow.length) {
      fs.writeFileSync(file.replace(/\.jpg$/, ".overflow.html"), html);
      throw new JobError(`Text does not fit on the image: ${overflow.join(", ")} (see ${path.basename(file, ".jpg")}.overflow.html)`, { kind: "retryable" });
    }
    await tab.screenshot({ path: file, type: "jpeg", quality: 92, clip: { x: 0, y: 0, ...SIZE } });
    return file;
  } finally {
    await context.close();
  }
}

/** Width and height from a JPEG's SOF marker (no image library needed). */
export function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    const length = buffer.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}
