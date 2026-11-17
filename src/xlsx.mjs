// Bağımlılıksız, küçük bir XLSX (Office Open XML) okuyucu.
// Yalnızca hücre değerlerini okur: paylaşılan metinler, satır içi metinler,
// sayılar ve formül sonuçları. Biçimlendirme, görseller vb. yok sayılır.
import { inflateRawSync } from "node:zlib";

const MAX_ENTRY_BYTES = 20 * 1024 * 1024; // tek dosya en fazla 20 MB açılır (zip bombasına karşı)
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/* ------------------------------- ZIP ------------------------------- */

export function isZip(buf) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  // End of Central Directory kaydını sondan geriye doğru ara
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: dizin sonu kaydı bulunamadı (dosya bozuk ya da ZIP değil)");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("ZIP: merkez dizin kaydı bozuk");
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (size > MAX_ENTRY_BYTES) throw new Error(`ZIP: ${name} çok büyük (${size} bayt)`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("ZIP: toplam açılmış boyut sınırı aşıldı");

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error(`ZIP: ${name} için yerel başlık bozuk`);
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new Error(`ZIP: desteklenmeyen sıkıştırma yöntemi ${method} (${name})`);
    files.set(name, data);
  }
  return files;
}

/* ------------------------------- XML yardımcıları ------------------------------- */

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function xmlDecode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENT[n]);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? xmlDecode(m[1]) : null;
}

// <si> / <is> içindeki tüm <t> parçalarını birleştir; fonetik (<rPh>) kısımlarını at
function richText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join("");
}

function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || [""])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1; // A → 0
}

/* ------------------------------- XLSX ------------------------------- */

// Döndürür: { date1904, sheets: [{ name, rows: Map<rowNumber, Map<colIndex, value>> }] }
// value: string | number | boolean
export function readXlsx(buf) {
  const files = readZip(buf);
  const text = (p) => (files.has(p) ? files.get(p).toString("utf8") : null);

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("XLSX: xl/workbook.xml yok (Excel dosyası değil)");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);

  const rels = new Map();
  for (const m of (text("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    let target = attr(m[0], "Target") || "";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    if (id) rels.set(id, target);
  }

  const shared = [...(text("xl/sharedStrings.xml") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]));

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name") || `Sayfa${sheets.length + 1}`;
    const rid = attr(m[0], "r:id");
    const xml = text(rels.get(rid) || "");
    if (!xml) continue;

    const rows = new Map();
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rnum = Number(attr(rm[1], "r"));
      const cells = new Map();
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1];
        const inner = cm[2] || "";
        const ref = attr(a, "r");
        if (!ref) continue;
        const t = attr(a, "t");
        let value = null;
        if (t === "inlineStr") {
          const is = inner.match(/<is>([\s\S]*?)<\/is>/);
          value = is ? richText(is[1]) : null;
        } else {
          const v = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (!v) continue;
          const raw = xmlDecode(v[1]);
          if (t === "s") value = shared[Number(raw)] ?? null;
          else if (t === "str" || t === "e") value = raw;
          else if (t === "b") value = raw === "1";
          else value = Number.isFinite(Number(raw)) ? Number(raw) : raw;
        }
        if (value === null || value === "") continue;
        cells.set(colIndex(ref), value);
      }
      if (cells.size) rows.set(rnum, cells);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error("XLSX: okunabilir sayfa bulunamadı");
  return { date1904, sheets };
}

// Excel seri tarihi → "YYYY-MM-DD" (1900 sistemi: 1899-12-30 tabanı; 1904 sistemi desteklenir)
export function excelSerialToISO(serial, date1904 = false) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  if (days < 20000 || days > 80000) return null; // ~1954–2119 dışı: tarih değil
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
