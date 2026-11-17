// Gazi Üniversitesi — herkese açık Google Sheet (CSV) ayrıştırıcısı.
//
// Sheet düzeni (tek sayfa, 5 sütun = Pzt–Cum). Her hafta bir blok:
//   tarih satırı : "16 Kasım 2026 Pazartesi" | ... | "20 Kasım 2026 Cuma"
//   sonra        : çorba, ana yemek, *etsiz alternatif, yardımcı yemek,
//                  tatlı/yanında satırları ve "Kalori:1200" satırı
// Bir sütunda "tatil"/"bayram" geçiyorsa o gün resmi tatil sayılır.
//
// Doğrulama: geçersiz tarih (31 Kasım) atlanır; gün adı tarihle uyuşmayan veya
// aynı tarihe iki FARKLI menü yazılmış gün "invalid" olarak işaretlenir ve
// menüsü yayımlanmaz.

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const DAYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];
const LABELS = ["ÇORBA", "ANA YEMEK", "ETSİZ ALTERNATİF", "YARDIMCI YEMEK", "TATLI / YANINDA"];

const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const fold = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/i̇/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[âà]/g, "a").replace(/[îì]/g, "i").replace(/[ûù]/g, "u");

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/* ------------------------------- CSV ------------------------------- */

// Tırnaklı alanları, alan içi virgül/satır sonlarını ve "" kaçışını doğru okur
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------- Hücreler ------------------------------- */

// "16 Kasım 2026 Pazartesi" | "16.11.2026" → { iso, weekdayOk, raw } | { invalid, raw } | null
export function parseDateCell(cell) {
  const raw = clean(cell);
  if (!raw) return null;
  const f = fold(raw);
  let y, m, d;
  let mm = f.match(/(\d{1,2})\s*[ .]?\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s*[ .]?\s*(\d{4})/);
  if (mm) {
    d = Number(mm[1]);
    m = MONTHS.indexOf(mm[2]) + 1;
    y = Number(mm[3]);
  } else {
    mm = f.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
    if (!mm) return null;
    d = Number(mm[1]);
    m = Number(mm[2]);
    y = Number(mm[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { invalid: true, raw };
  }
  // Hücrede yazan gün adı tarihle uyuşuyor mu? (kelime sınırı: "pazar" ≠ "pazartesi")
  let named = -1;
  DAYS.forEach((day, i) => {
    if (new RegExp(`(^|[^a-z])${day}([^a-z]|$)`).test(f)) {
      if (named === -1 || day.length > DAYS[named].length) named = i;
    }
  });
  return { iso: iso(y, m, d), weekdayOk: named === -1 || named === dt.getUTCDay(), raw };
}

const isHoliday = (s) => /tatil|bayram/.test(fold(s));
const calorieOf = (s) => {
  const m = fold(s).match(/^kalori\s*[:=]?\s*(\d{2,5})/);
  return m ? Number(m[1]) : null;
};
const niceName = (s) => {
  const t = clean(s).replace(/^\*+\s*/, "");
  return t ? t.charAt(0).toLocaleUpperCase("tr") + t.slice(1) : "";
};

/* ------------------------------- Ayrıştırma ------------------------------- */

// Döndürür: { days: { ISO: day }, issues: [] }
// day = { date, meals: { ogle? }, holiday?: { text }, invalid?: { reason } }
export function parseGaziRows(rows) {
  const days = {};
  const issues = [];
  let block = null;

  const isDateRow = (r) => r.some((c) => parseDateCell(c));

  const flush = () => {
    if (!block) return;
    const menuRows = block.rows.filter((r) => r.some((c) => clean(c)));
    const isCalRow = (r) => r.some((c) => calorieOf(c) !== null);
    const standard = menuRows.filter((r) => !isCalRow(r)).length === LABELS.length;

    block.cols.forEach((info, col) => {
      if (!info) return;
      if (info.invalid) {
        issues.push(`Geçersiz tarih: "${info.raw}"`);
        return;
      }

      const items = [];
      let calories = null;
      let holidayText = isHoliday(info.raw) ? info.raw : null;
      let foodIdx = -1;

      for (const r of menuRows) {
        const food = !isCalRow(r);
        if (food) foodIdx++;
        const cell = clean(r[col]);
        if (!cell) continue;
        const cal = calorieOf(cell);
        if (cal !== null) {
          calories = cal;
          continue;
        }
        if (isHoliday(cell)) {
          holidayText = holidayText || cell;
          continue;
        }
        const veg = /^\*/.test(cell);
        const name = niceName(cell);
        if (!name || name.length > 160) continue;
        let category = null;
        if (veg) category = "ETSİZ ALTERNATİF";
        else if (standard && food) category = LABELS[foodIdx] || null;
        else if (/corba/.test(fold(cell))) category = "ÇORBA";
        items.push({ category, name, kcal: null, description: null, allergens: [] });
      }

      let day;
      if (!info.weekdayOk) {
        day = { date: info.iso, meals: {}, invalid: { reason: "Gün adı tarihle uyuşmuyor" } };
        issues.push(`Gün adı tarihle uyuşmuyor: "${info.raw}"`);
      } else if (holidayText) {
        day = { date: info.iso, meals: {}, holiday: { text: clean(holidayText) } };
      } else if (items.length) {
        day = { date: info.iso, meals: { ogle: { time: null, totalKcal: calories, items, text: null } } };
      } else {
        return; // boş sütun: menü henüz girilmemiş
      }

      const prev = days[info.iso];
      if (prev) {
        if (JSON.stringify(prev) !== JSON.stringify(day)) {
          days[info.iso] = { date: info.iso, meals: {}, invalid: { reason: "Bu tarihe iki farklı menü girilmiş" } };
          issues.push(`Çakışan tarih: ${info.iso}`);
        }
        return;
      }
      days[info.iso] = day;
    });
    block = null;
  };

  for (const r of rows) {
    if (isDateRow(r)) {
      flush();
      block = { cols: r.map((c) => parseDateCell(c)), rows: [] };
    } else if (block) {
      block.rows.push(r);
    }
  }
  flush();
  return { days, issues };
}

export function parseGaziCsv(text) {
  const t = String(text || "");
  if (/^\s*</.test(t)) throw new Error("CSV yerine HTML geldi (sheet erişime kapatılmış olabilir)");
  const result = parseGaziRows(parseCSV(t));
  if (!Object.keys(result.days).length) throw new Error("sheet içinde tarih bulunamadı (format değişmiş olabilir)");
  return result;
}
