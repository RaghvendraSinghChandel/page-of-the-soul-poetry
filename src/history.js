import fs from "node:fs";
import path from "node:path";

// Every drafted post lives in state/history.json (newest last), next to the outcome of each daily
// publishing slot. The posts are mirrored to posts_log.csv in the project root for a spreadsheet.

const CSV_HEADER = "date,category,theme,content_type,author,work,reference,source_url,verification,copyright,main_text,image_files,status";

export function createHistory({ stateDir, csvFile }) {
  const file = path.join(stateDir, "history.json");

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  const load = () => read().posts || [];
  const slots = () => read().slots || {};

  function save(posts, slotStates = slots()) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ posts, slots: slotStates }, null, 2)}\n`);
    fs.renameSync(tmp, file);
    writeCsv(posts);
  }

  function writeCsv(posts) {
    if (!csvFile) return;
    const cell = value => {
      const text = String(value ?? "").replace(/\r?\n/g, " | ");
      return /[",|]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = posts.map(p =>
      [
        p.date,
        p.categoryName || p.category,
        p.topic,
        p.couplet ? "Verified doha + mool rachna" : p.contentType || "Mool rachna",
        p.couplet?.poet || p.author || "Mool rachna",
        p.couplet?.work || p.work || "",
        p.couplet ? `${p.couplet.form} ${p.couplet.number}` : p.reference || "",
        p.couplet?.permalink || p.sourceUrl || "",
        p.couplet ? `Exact text matched on live Wikisource page (rev ${p.couplet.revid})` : p.verification || "Mool rachna, verification ki zaroorat nahi",
        p.couplet?.rights || p.copyright || "Mool rachna",
        [p.couplet?.lines?.join(" / "), (p.poem || []).join(" / ")].filter(Boolean).join(" || "),
        (p.slides || []).join("; "),
        p.status + (p.permalink ? ` ${p.permalink}` : ""),
      ]
        .map(cell)
        .join(",")
    );
    // BOM so Excel opens the Devanagari text as UTF-8.
    fs.writeFileSync(csvFile, `\ufeff${[CSV_HEADER, ...rows].join("\n")}\n`);
  }

  return {
    file,
    load,
    /** Newest first. */
    recent: () => load().reverse(),
    add(post) {
      const posts = load();
      posts.push(post);
      save(posts);
    },
    update(id, changes) {
      const posts = load();
      const index = posts.findIndex(p => p.id === id);
      if (index < 0) throw new Error(`No post ${id} in history`);
      posts[index] = { ...posts[index], ...changes };
      save(posts);
      return posts[index];
    },
    slot: key => slots()[key],
    updateSlot(key, changes) {
      const all = slots();
      all[key] = { ...all[key], ...changes, updatedAt: new Date().toISOString() };
      save(load(), all);
      return all[key];
    },
  };
}
