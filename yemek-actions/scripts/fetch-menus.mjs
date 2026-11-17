// Menüleri çeker, docs/data/*.json olarak yazar. Node 20+, bağımlılık yok.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHacettepe, parseAnku } from "../src/parsers.mjs";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "data");
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 7); // bugünden itibaren kaç gün
const LOCATIONS = (process.env.HACETTEPE_LOCATIONS || "1,2").split(",").map((s) => s.trim());
const HACETTEPE = "https://beslenme.hacettepe.edu.tr/";
const ANKU = "https://sksbasvuru.ankara.edu.tr/kayit/moduller/yemeklistesi/aylikmenu.php";
const UA = "Mozilla/5.0 (compatible; yemek-actions/1.0; +github-actions)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function istanbulToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }); // YYYY-MM-DD
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} <- ${url}`);
  const buf = await res.arrayBuffer();
  let charset = ((res.headers.get("content-type") || "").match(/charset=([^;]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset.trim()).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

// İçerik değişmediyse dosyayı yeniden yazma (gereksiz commit olmasın)
async function writeIfChanged(name, payload, contentKey) {
  const file = path.join(OUT_DIR, name);
  let old = null;
  try {
    old = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  if (old && JSON.stringify(old[contentKey]) === JSON.stringify(payload[contentKey])) {
    console.log(`= ${name}: değişiklik yok`);
    return false;
  }
  await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`+ ${name}: güncellendi`);
  return true;
}

function hasMenu(day) {
  return Object.values(day.meals).some((m) => m.items.length || m.text);
}

async function hacettepe() {
  const today = istanbulToday();
  let okLocations = 0;
  for (const loc of LOCATIONS) {
    const days = {};
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = addDays(today, i);
      try {
        const html = await fetchText(`${HACETTEPE}?date=${date}&location_id=${loc}`);
        const day = parseHacettepe(html, date, loc);
        if (hasMenu(day)) days[date] = day;
        else console.log(`  (${date}, konum ${loc}: menü yok)`);
      } catch (e) {
        console.warn(`::warning::Hacettepe ${date} konum ${loc}: ${e.message}`);
      }
      await sleep(600); // siteyi yormayalım
    }
    if (Object.keys(days).length) {
      okLocations++;
      await writeIfChanged(
        `hacettepe-${loc}.json`,
        { source: "beslenme.hacettepe.edu.tr", updated: new Date().toISOString(), days },
        "days"
      );
    } else {
      console.warn(`::warning::Hacettepe konum ${loc}: hiç menü alınamadı, eski dosya korunuyor`);
    }
  }
  return okLocations;
}

async function anku() {
  try {
    const html = await fetchText(ANKU);
    const data = parseAnku(html);
    await writeIfChanged(
      "anku.json",
      { source: "sksbasvuru.ankara.edu.tr", updated: new Date().toISOString(), ...data },
      "tables"
    );
  } catch (e) {
    // Ankü başarısız olsa da iş kırmızıya düşmesin; Hacettepe devam etsin
    console.warn(`::warning::Ankara Üniversitesi alınamadı: ${e.message}`);
  }
}

await mkdir(OUT_DIR, { recursive: true });
const ok = await hacettepe();
await anku();
if (ok === 0) {
  console.error("Hacettepe için hiçbir konumdan menü alınamadı.");
  process.exit(1);
}
