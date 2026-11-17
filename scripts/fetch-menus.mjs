// Menüleri çeker, docs/data/*.json olarak yazar. Node 20+, bağımlılık yok.
//
// Güvenlik önlemleri:
//  • Her istek zaman aşımlı ve 3 denemeli (artan bekleme ile).
//  • Hacettepe: sayfanın gösterdiği tarih istenen tarihle aynı değilse o gün REDDEDİLİR
//    (site ?date= parametresini yok sayarsa yanlış menü yazılmaz).
//  • Bir gün çekilemezse eski dosyadaki aynı gün korunur; hiçbir şey çekilemezse dosyaya dokunulmaz.
//  • Ankü: yalnızca gerçek XLSX kabul edilir; ay başlığıyla uyuşmayan / çakışan tarihler atılır.
//  • Gazi: Google Sheet CSV'si; tatil günleri işaretlenir, gün adı uyuşmayan / çakışan
//    tarihler "invalid" olarak yayımlanır (menüsü gösterilmez).
//  • Yazmadan önce şema doğrulaması; geçersiz veri asla yazılmaz.
//  • İçerik değişmediyse dosya yeniden yazılmaz (gereksiz commit yok).
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHacettepe, parseAnkuXlsx, dayHasMenu } from "../src/parsers.mjs";
import { isZip } from "../src/xlsx.mjs";
import { parseGaziCsv } from "../src/gazi.mjs";
import { validateDays } from "../src/validate.mjs";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "data");
const DAYS_AHEAD = Math.min(Math.max(Number(process.env.DAYS_AHEAD || 7), 1), 21);
const LOCATIONS = (process.env.HACETTEPE_LOCATIONS || "1,2").split(",").map((s) => s.trim()).filter(Boolean);
const HACETTEPE = "https://beslenme.hacettepe.edu.tr/";
const ANKU = "https://sksbasvuru.ankara.edu.tr/kayit/moduller/yemeklistesi/aylikmenu.php";
const GAZI_SHEET_ID = process.env.GAZI_SHEET_ID || "1koCBOca2hgdGno3NJ0vR_VJ0wqLxXpXR5fpJQDAjTGM";
const GAZI_KEEP_PAST_DAYS = 42; // geçmiş haftalar en fazla 6 hafta tutulur
const UA = "Mozilla/5.0 (compatible; uniyemekscrapper/2.0; +https://github.com/BeratOrkun/uniyemekscrapper)";
const TIMEOUT_MS = 25000;
const SCHEMA_VERSION = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = [];

function istanbulToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }); // YYYY-MM-DD
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchWithRetry(url, accept, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "tr-TR,tr;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType: res.headers.get("content-type") || "" };
    } catch (e) {
      lastErr = e;
      if (i < attempts) await sleep(i * 2500);
    }
  }
  throw new Error(`${lastErr?.message || lastErr} <- ${url}`);
}

function decodeText(buf, contentType) {
  let charset = (contentType.match(/charset=([^;]+)/i) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString("latin1");
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset.trim()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function readOld(name) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, name), "utf8"));
  } catch {
    return null;
  }
}

async function writeIfChanged(name, payload) {
  const errors = validateDays(payload.days);
  if (errors.length) {
    console.error(`::error::${name} şema doğrulamasından geçmedi, YAZILMADI: ${errors.slice(0, 5).join("; ")}`);
    return false;
  }
  const old = await readOld(name);
  const same =
    old &&
    old.schemaVersion === payload.schemaVersion &&
    JSON.stringify(old.days) === JSON.stringify(payload.days) &&
    JSON.stringify(old.month ?? null) === JSON.stringify(payload.month ?? null);
  if (same) {
    console.log(`= ${name}: değişiklik yok`);
    return false;
  }
  await writeFile(path.join(OUT_DIR, name), JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`+ ${name}: güncellendi (${Object.keys(payload.days).length} gün)`);
  return true;
}

/* ------------------------------ Hacettepe ------------------------------ */

async function hacettepe() {
  const today = istanbulToday();
  let parsedPages = 0; // sayfa alındı ve doğrulandı (menü olsun olmasın)
  let failedPages = 0; // ağ hatası ya da yapı/tarih doğrulaması başarısız

  for (const loc of LOCATIONS) {
    const file = `hacettepe-${loc}.json`;
    const old = await readOld(file);
    const oldDays = old?.days && typeof old.days === "object" ? old.days : {};
    const days = {};
    const issues = [];
    let locationName = old?.location?.name || null;
    let locParsed = 0;

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = addDays(today, i);
      try {
        const { buf, contentType } = await fetchWithRetry(`${HACETTEPE}?date=${date}&location_id=${loc}`, "text/html");
        const res = parseHacettepe(decodeText(buf, contentType), date, loc);
        if (!res.ok) throw new Error(res.reason);
        parsedPages++;
        locParsed++;
        locationName = res.day.location.name;
        if (dayHasMenu(res.day)) days[date] = res.day;
        else console.log(`  (${date}, konum ${loc}: menü yayımlanmamış)`);
      } catch (e) {
        failedPages++;
        const msg = `${date}: ${e.message}`;
        issues.push(msg);
        console.warn(`::warning::Hacettepe konum ${loc} ${msg}`);
        if (oldDays[date]) {
          days[date] = oldDays[date]; // eski (doğrulanmış) veriyi koru
          console.log(`  (${date}, konum ${loc}: önceki kayıt korundu)`);
        }
      }
      await sleep(700); // siteyi yormayalım
    }

    if (locParsed === 0) {
      console.warn(`::warning::Hacettepe konum ${loc}: hiçbir gün doğrulanamadı, dosyaya dokunulmadı`);
      summary.push(`| Hacettepe ${loc} | ❌ hiçbir gün alınamadı, eski dosya korundu |`);
      continue;
    }

    await writeIfChanged(file, {
      schemaVersion: SCHEMA_VERSION,
      source: "beslenme.hacettepe.edu.tr",
      sourceUrl: HACETTEPE,
      updated: new Date().toISOString(),
      location: { id: Number(loc), name: locationName || (loc === "2" ? "Sıhhiye" : "Beytepe") },
      days,
      issues,
    });
    summary.push(`| Hacettepe ${loc} (${locationName}) | ✅ ${Object.keys(days).length} gün menü, ${issues.length} sorun |`);
  }
  return { parsedPages, failedPages };
}

/* ---------------------------- Ankara Üniversitesi ---------------------------- */

async function anku() {
  const file = "anku.json";
  try {
    const { buf, contentType } = await fetchWithRetry(
      ANKU,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*"
    );
    if (!isZip(buf)) {
      const head = buf.subarray(0, 200).toString("utf8").replace(/\s+/g, " ");
      throw new Error(`XLSX beklenirken farklı içerik geldi (${contentType || "tür yok"}): ${head.slice(0, 80)}`);
    }
    const parsed = parseAnkuXlsx(buf);
    parsed.issues.forEach((m) => console.warn(`::warning::Ankü: ${m}`));
    if (!Object.keys(parsed.days).length) throw new Error("dosyada geçerli gün bulunamadı");

    await writeIfChanged(file, {
      schemaVersion: SCHEMA_VERSION,
      source: "sksbasvuru.ankara.edu.tr",
      sourceUrl: ANKU,
      officialPage: "https://sks.ankara.edu.tr/yemek-hizmetleri-2/",
      updated: new Date().toISOString(),
      month: parsed.month,
      title: parsed.title,
      days: parsed.days,
      issues: parsed.issues,
    });
    summary.push(`| Ankara Üniversitesi | ✅ ${parsed.title || parsed.month}: ${Object.keys(parsed.days).length} gün, ${parsed.issues.length} uyarı |`);
    return true;
  } catch (e) {
    // Ankü başarısız olsa da iş kırmızıya düşmesin; eski dosya korunur
    console.warn(`::warning::Ankara Üniversitesi alınamadı, eski dosya korundu: ${e.message}`);
    summary.push(`| Ankara Üniversitesi | ⚠️ alınamadı, eski dosya korundu: ${String(e.message).slice(0, 120)} |`);
    return false;
  }
}

/* ---------------------------- Gazi Üniversitesi ---------------------------- */

async function gazi() {
  const file = "gazi.json";
  const urls = [
    `https://docs.google.com/spreadsheets/d/${GAZI_SHEET_ID}/export?format=csv`,
    `https://docs.google.com/spreadsheets/d/${GAZI_SHEET_ID}/gviz/tq?tqx=out:csv&headers=0`,
  ];
  try {
    let parsed = null;
    let lastErr = null;
    for (const url of urls) {
      try {
        const { buf } = await fetchWithRetry(url, "text/csv,*/*");
        parsed = parseGaziCsv(buf.toString("utf8"));
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!parsed) throw lastErr || new Error("sheet okunamadı");
    parsed.issues.forEach((m) => console.warn(`::warning::Gazi: ${m}`));

    // Çok eski haftaları at (dosya şişmesin)
    const oldest = addDays(istanbulToday(), -GAZI_KEEP_PAST_DAYS);
    const days = Object.fromEntries(Object.entries(parsed.days).filter(([d]) => d >= oldest).sort());
    if (!Object.keys(days).length) throw new Error("güncel tarihli gün yok");

    await writeIfChanged(file, {
      schemaVersion: SCHEMA_VERSION,
      source: "Gazi Üniversitesi yemek listesi (Google Sheets)",
      officialPage: "https://mediko.gazi.edu.tr/view/page/20412/yemek-listesi",
      updated: new Date().toISOString(),
      days,
      issues: parsed.issues,
    });
    const isos = Object.keys(days);
    summary.push(`| Gazi Üniversitesi | ✅ ${isos.length} gün (${isos[0]} → ${isos[isos.length - 1]}), ${parsed.issues.length} uyarı |`);
    return true;
  } catch (e) {
    console.warn(`::warning::Gazi alınamadı, eski dosya korundu: ${e.message}`);
    summary.push(`| Gazi Üniversitesi | ⚠️ alınamadı, eski dosya korundu: ${String(e.message).slice(0, 120)} |`);
    return false;
  }
}

/* ---------------------------------- Çalıştır ---------------------------------- */

await mkdir(OUT_DIR, { recursive: true });
const h = await hacettepe();
await anku();
await gazi();

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Yemek listeleri", "", "| Kaynak | Durum |", "|---|---|", ...summary, ""].join("\n")
  ).catch(() => {});
}
console.log(summary.join("\n"));

// Site ulaşılamaz ya da yapısı değişmişse (hiçbir sayfa doğrulanamadıysa) iş kırmızı olsun ve e-posta gelsin.
// Menünün yayımlanmamış olması (tatil vb.) hata DEĞİLDİR.
if (h.parsedPages === 0 && h.failedPages > 0) {
  console.error("::error::Hacettepe: hiçbir sayfa doğrulanamadı (site kapalı ya da yapısı değişmiş).");
  process.exit(1);
}
