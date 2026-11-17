// HTML / XLSX -> JSON ayrıştırıcıları (bağımlılık yok)
import { readXlsx, excelSerialToISO } from "./xlsx.mjs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(html) {
  return decode(
    String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

function parseAllergens(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((a) => ({ code: clean(a?.kodu), description: clean(a?.aciklama) }))
      .filter((a) => a.code);
  } catch {
    return [];
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidISO(iso) {
  if (!ISO_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/* ------------------------------ Hacettepe ------------------------------ */

export const HACETTEPE_MEALS = ["sabah", "ogle", "aksam", "vegan"];

// Sayfanın GERÇEKTEN hangi tarihi gösterdiği (tarih seçici / gizli alan)
export function hacettepePageDate(html) {
  const m =
    html.match(/id="flatpickr-input"[^>]*value="(\d{4}-\d{2}-\d{2})"/) ||
    html.match(/value="(\d{4}-\d{2}-\d{2})"[^>]*id="flatpickr-input"/) ||
    html.match(/<input[^>]*name="date"[^>]*value="(\d{4}-\d{2}-\d{2})"/) ||
    html.match(/<input[^>]*value="(\d{4}-\d{2}-\d{2})"[^>]*name="date"/);
  return m ? m[1] : null;
}

// Konum adları sayfadaki seçim kutusundan okunur (ör. 1 → Beytepe)
export function hacettepeLocationName(html, id) {
  const re = new RegExp(`<option[^>]*value="${Number(id)}"[^>]*>([\\s\\S]*?)</option>`);
  const m = html.match(re);
  const name = m ? clean(stripTags(m[1])) : "";
  return name || (String(id) === "2" ? "Sıhhiye" : "Beytepe");
}

const NOT_FOUND_RE = /men[üu]s[üu]\s+bulunamad[ıi]/i;

// Döndürür: { ok: true, day } | { ok: false, reason }
export function parseHacettepe(html, date, location) {
  if (typeof html !== "string" || html.length < 500) return { ok: false, reason: "boş/kısa yanıt" };
  if (!/<section id="(sabah|ogle|aksam|vegan)"/.test(html)) {
    return { ok: false, reason: "beklenen sayfa yapısı yok (section#ogle bulunamadı)" };
  }

  const pageDate = hacettepePageDate(html);
  if (!pageDate) return { ok: false, reason: "sayfadaki tarih okunamadı" };
  if (pageDate !== date) return { ok: false, reason: `istenen ${date}, sayfa ${pageDate} gösteriyor` };

  const meals = {};
  for (const id of HACETTEPE_MEALS) {
    const start = html.indexOf(`<section id="${id}"`);
    if (start < 0) continue;
    const nextStarts = HACETTEPE_MEALS.map((m) => html.indexOf(`<section id="${m}"`, start + 10)).filter((i) => i > start);
    const mainEnd = html.indexOf("</main>", start);
    const ends = [...nextStarts, mainEnd].filter((i) => i > start);
    const section = html.slice(start, ends.length ? Math.min(...ends) : undefined);

    // Yalnızca günlük görünüm (haftalık görünüm aynı yemekleri tekrarlar)
    const dIdx = section.indexOf("daily-view");
    const dStart = dIdx >= 0 ? section.lastIndexOf("<", dIdx) : -1;
    const wIdx = section.indexOf("weekly-view");
    const wStart = wIdx >= 0 ? section.lastIndexOf("<", wIdx) : -1;
    const daily = dStart >= 0 ? section.slice(dStart, wStart > dStart ? wStart : undefined) : "";
    if (!daily) continue;

    const dailyText = stripTags(daily);
    if (NOT_FOUND_RE.test(dailyText) && !/menu-card|kahvalti-items/.test(daily)) {
      meals[id] = { time: null, totalKcal: null, items: [], text: null };
      continue;
    }

    const time = clean((daily.match(/Servis Saati<\/small>\s*<strong[^>]*>([^<]+)</) || [])[1]) || null;
    const kcalRaw = (daily.match(/<strong>(\d+)<\/strong>\s*kcal/) || [])[1];
    const totalKcal = kcalRaw && Number(kcalRaw) > 0 ? Number(kcalRaw) : null;

    let items = [...daily.matchAll(/<div class="menu-card"[^>]*>/g)]
      .map((m) => ({
        category: clean(attr(m[0], "data-category")) || null,
        name: clean(attr(m[0], "data-title")),
        kcal: Number(attr(m[0], "data-cal")) > 0 ? Number(attr(m[0], "data-cal")) : null,
        description: clean(attr(m[0], "data-desc")).replace(/^Açıklama bulunmuyor\.?$/i, "") || null,
        allergens: parseAllergens(attr(m[0], "data-alerjenler")),
      }))
      .filter((it) => it.name);

    // Kahvaltı: <ul class="kahvalti-items"><li>…</li></ul>
    if (!items.length) {
      const ul = daily.match(/<ul class="kahvalti-items"[^>]*>([\s\S]*?)<\/ul>/);
      if (ul) {
        items = [...ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
          .map((m) => clean(stripTags(m[1])))
          .filter(Boolean)
          .map((name) => ({ category: "KAHVALTI", name, kcal: null, description: null, allergens: [] }));
      }
    }

    // Aynı yemek iki kez gelmesin
    const seen = new Set();
    items = items.filter((it) => {
      const k = `${it.category}|${it.name}`.toLocaleLowerCase("tr");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    meals[id] = { time, totalKcal, items, text: null };
  }

  const day = {
    date,
    location: { id: Number(location), name: hacettepeLocationName(html, location) },
    meals,
  };
  return { ok: true, day };
}

export function dayHasMenu(day) {
  return Object.values(day?.meals || {}).some((m) => Array.isArray(m.items) && m.items.length > 0);
}

/* ---------------------------- Ankara Üniversitesi ---------------------------- */
// Kaynak: aylık Excel (xlsx). Sayfa düzeni (Kasım 2026):
//   A2: "KASIM 2026 YEMEK MENÜSÜ"
//   A: tarih (Excel seri sayısı) | B: çorba | C: ana yemek | D: yardımcı | E: tatlı/salata/içecek | F: "1364 KKAL"
// Hücreler "YEŞİL MERCİMEK ÇORBA (200 kkal)" biçiminde.

const MONTHS_TR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const fold = (s) =>
  String(s)
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
const MONTHS_FOLD = MONTHS_TR.map(fold);

function textDateToISO(text) {
  const f = fold(text);
  let m = f.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isValidISO(iso) ? iso : null;
  }
  m = f.match(/\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(\d{4})\b/);
  if (m) {
    const iso = `${m[3]}-${String(MONTHS_FOLD.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isValidISO(iso) ? iso : null;
  }
  return null;
}

// "KASIM 2026 YEMEK MENÜSÜ" → "2026-11"
function findMenuMonth(sheet) {
  for (const cells of sheet.rows.values()) {
    for (const v of cells.values()) {
      if (typeof v !== "string") continue;
      const f = fold(v);
      const m = f.match(/(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(\d{4})/);
      if (m && /menu|yemek/.test(f)) {
        return { month: `${m[2]}-${String(MONTHS_FOLD.indexOf(m[1]) + 1).padStart(2, "0")}`, title: clean(v) };
      }
    }
  }
  return { month: null, title: null };
}

// Büyük harfli metni okunur hale getir: "İSVEÇ KÖFTE/SEBZE GARNİTÜR" → "İsveç Köfte / Sebze Garnitür"
export function niceTurkish(s) {
  return clean(s)
    .toLocaleLowerCase("tr")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/(^|[\s(/-])(\p{L})/gu, (m, p, c) => p + c.toLocaleUpperCase("tr"));
}

function parseAnkuDish(raw) {
  const text = clean(raw);
  const m = text.match(/^(.*?)\s*\(\s*(\d{1,4})\s*k?kal\s*\)\s*$/i);
  const name = niceTurkish(m ? m[1] : text);
  const kcal = m ? Number(m[2]) : null;
  return name ? { name, kcal } : null;
}

const ANKU_LABELS = ["ÇORBA", "ANA YEMEK", "YARDIMCI YEMEK", "TATLI / YANINDA"];
const TOTAL_KCAL_RE = /^\s*(\d{2,5})\s*k?kal\s*$/i;

// Döndürür: { month, title, days: { ISO: day }, issues: [] }
export function parseAnkuXlsx(buf) {
  const wb = readXlsx(buf);
  const issues = [];

  // Tarih sütunu en çok satıra sahip sayfayı menü sayfası kabul et
  const scored = wb.sheets.map((sheet) => {
    let dated = 0;
    for (const cells of sheet.rows.values()) {
      const a = cells.get(0);
      if ((typeof a === "number" && excelSerialToISO(a, wb.date1904)) || (typeof a === "string" && textDateToISO(a))) dated++;
    }
    return { sheet, dated };
  });
  scored.sort((x, y) => y.dated - x.dated);
  const best = scored[0];
  if (!best || best.dated === 0) throw new Error("Ankü: tarih sütunu olan sayfa bulunamadı (format değişmiş olabilir)");

  const { month, title } = findMenuMonth(best.sheet);
  if (!month) issues.push("Başlıkta ay/yıl bulunamadı; tarihler ay kontrolü olmadan alındı");

  const days = {};
  const conflicts = new Set();

  for (const [rnum, cells] of [...best.sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    const a = cells.get(0);
    const iso = typeof a === "number" ? excelSerialToISO(a, wb.date1904) : typeof a === "string" ? textDateToISO(a) : null;
    if (!iso) continue;

    if (month && !iso.startsWith(month + "-")) {
      issues.push(`Satır ${rnum}: ${iso} tarihi "${title}" ayına ait değil, atlandı`);
      continue;
    }

    const items = [];
    let totalKcal = null;
    for (const [col, v] of [...cells.entries()].sort((x, y) => x[0] - y[0])) {
      if (col === 0) continue;
      const text = clean(v);
      if (!text) continue;
      const tk = text.match(TOTAL_KCAL_RE);
      if (tk) {
        totalKcal = Number(tk[1]);
        continue;
      }
      const dish = parseAnkuDish(text);
      if (dish) items.push(dish);
    }
    if (!items.length) {
      issues.push(`Satır ${rnum}: ${iso} için yemek yok, atlandı`);
      continue;
    }

    items.forEach((it, i) => {
      it.category = /corba/.test(fold(it.name)) ? "ÇORBA" : items.length === 4 ? ANKU_LABELS[i] : null;
      it.description = null;
      it.allergens = [];
    });
    const sum = items.reduce((s, it) => s + (it.kcal || 0), 0);

    const day = {
      date: iso,
      meals: { ogle: { time: null, totalKcal: totalKcal || sum || null, items, text: null } },
    };

    if (days[iso]) {
      const same = JSON.stringify(days[iso].meals) === JSON.stringify(day.meals);
      if (!same) conflicts.add(iso);
      continue;
    }
    days[iso] = day;
  }

  for (const iso of conflicts) {
    delete days[iso];
    issues.push(`${iso}: aynı tarihe iki farklı menü yazılmış, gün yayımlanmadı`);
  }

  return { month, title, days, issues };
}
