// HTML -> JSON ayrıştırıcıları (bağımlılık yok)

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(html) {
  return decode(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

function parseAllergens(raw) {
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((a) => ({ code: a.kodu, description: a.aciklama }));
  } catch {
    return [];
  }
}

/* ------------------------------ Hacettepe ------------------------------ */

const MEALS = ["sabah", "ogle", "aksam", "vegan"];

export function parseHacettepe(html, date, location) {
  const meals = {};
  for (const id of MEALS) {
    const start = html.indexOf(`<section id="${id}"`);
    if (start < 0) continue;
    const nextStarts = MEALS.map((m) => html.indexOf(`<section id="${m}"`, start + 10)).filter((i) => i > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : html.indexOf("</main>", start);
    const section = html.slice(start, end > start ? end : undefined);

    const dIdx = section.indexOf("daily-view");
    const dStart = dIdx >= 0 ? section.lastIndexOf("<", dIdx) : -1; // etiketin başından kes
    const wIdx = section.indexOf("weekly-view");
    const wStart = wIdx >= 0 ? section.lastIndexOf("<", wIdx) : -1;
    const daily = dStart >= 0 ? section.slice(dStart, wStart > dStart ? wStart : undefined) : "";

    const time = (daily.match(/Servis Saati<\/small>\s*<strong[^>]*>([^<]+)</) || [])[1]?.trim() || null;
    const kcal = (daily.match(/<strong>(\d+)<\/strong>\s*kcal/) || [])[1];

    const items = [...daily.matchAll(/<div class="menu-card"[^>]*>/g)].map((m) => ({
      category: attr(m[0], "data-category"),
      name: attr(m[0], "data-title"),
      kcal: Number(attr(m[0], "data-cal")) || null,
      description: (attr(m[0], "data-desc") || "").replace(/^Açıklama bulunmuyor\.?$/, "") || null,
      allergens: parseAllergens(attr(m[0], "data-alerjenler")),
    }));

    let text = null;
    if (!items.length) {
      text =
        stripTags(daily)
          .replace(/^.*?Servis Saati\s*[\d:\s-]+\d*\s*kcal\s*\d*\s*Çeşit\s*/i, "")
          .replace(/\s*Hacettepe Epostanız.*$/i, "")
          .trim() || null;
    }

    meals[id] = { time, totalKcal: kcal ? Number(kcal) : null, items, text };
  }

  return {
    date,
    location: { id: Number(location), name: location === "2" || location === 2 ? "Sıhhiye" : "Beytepe" },
    meals,
  };
}

/* ---------------------------- Ankara Üniversitesi ---------------------------- */
// UYARI: Sayfa yapısı doğrulanamadı; genel tablo ayrıştırıcı. README'deki "Ankü" bölümüne bakın.

const MONTHS = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 };

function normalizeDate(text) {
  let m = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = text
    .toLocaleLowerCase("tr")
    .match(/\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})\b/);
  if (m) return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export function parseAnku(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => {
      const cells = [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
      return { date: cells.map(normalizeDate).find(Boolean) || null, cells };
    })
  );
  return {
    tableCount: tables.length,
    tables,
    text: tables.length ? undefined : stripTags(html).slice(0, 4000),
  };
}
