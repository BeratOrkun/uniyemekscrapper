// Ayrıştırıcı testleri — gerçek sayfa/dosya örnekleriyle.  Çalıştır: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHacettepe, parseAnkuXlsx, dayHasMenu, hacettepePageDate, niceTurkish, isValidISO } from "../src/parsers.mjs";
import { isZip, excelSerialToISO } from "../src/xlsx.mjs";

const fx = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const html = (name) => readFileSync(fx(name), "utf8");

test("Hacettepe: dolu gün doğru ayrıştırılır", () => {
  const res = parseHacettepe(html("hacettepe-2026-11-18-beytepe.html"), "2026-11-18", "1");
  assert.equal(res.ok, true);
  const { day } = res;
  assert.equal(day.date, "2026-11-18");
  assert.equal(day.location.name, "Beytepe");
  assert.ok(dayHasMenu(day));

  const ogle = day.meals.ogle;
  assert.deepEqual(ogle.items.map((i) => i.name), ["Tarhana Çorbası", "Tavuk But", "Kısır", "Supangle"]);
  assert.equal(ogle.time, "11:30 - 14:00");
  assert.ok(ogle.totalKcal > 0);
  ogle.items.forEach((i) => assert.ok(i.category));

  // Kahvaltı listesi madde madde gelmeli, metin yığını değil
  const sabah = day.meals.sabah;
  assert.ok(sabah.items.length >= 3);
  assert.equal(sabah.items[0].name, "Çay");
  assert.equal(sabah.text, null);
});

test("Hacettepe: sayfa başka tarihi gösteriyorsa reddedilir", () => {
  const res = parseHacettepe(html("hacettepe-2026-11-18-beytepe.html"), "2026-11-19", "1");
  assert.equal(res.ok, false);
  assert.match(res.reason, /istenen 2026-11-19/);
});

test("Hacettepe: 'menüsü bulunamadı' metni menü sayılmaz", () => {
  // 20 Aralık (Pazar): yalnızca kahvaltı yayımlanmış; öğle/akşam/vegan "bulunamadı"
  const res = parseHacettepe(html("hacettepe-2026-12-20-bos.html"), "2026-12-20", "1");
  assert.equal(res.ok, true);
  for (const key of ["ogle", "aksam", "vegan"]) {
    assert.equal(res.day.meals[key].items.length, 0, key);
    assert.equal(res.day.meals[key].text, null, key);
  }
  assert.ok(res.day.meals.sabah.items.length > 0);
  // Sadece "bulunamadı" sayfası menü sayılmamalı
  const onlyMissing = { meals: { ogle: res.day.meals.ogle, aksam: res.day.meals.aksam } };
  assert.equal(dayHasMenu(onlyMissing), false);
});

test("Hacettepe: beklenmeyen içerik reddedilir", () => {
  assert.equal(parseHacettepe("<html><body>Bakım çalışması</body></html>".repeat(40), "2026-11-18", "1").ok, false);
  assert.equal(parseHacettepe("", "2026-11-18", "1").ok, false);
  assert.equal(hacettepePageDate("<html></html>"), null);
});

test("Ankü: aylık Excel doğru ayrıştırılır", () => {
  const buf = readFileSync(fx("anku-2026-11.xlsx"));
  assert.ok(isZip(buf));
  const r = parseAnkuXlsx(buf);
  assert.equal(r.month, "2026-11");
  assert.match(r.title, /KASIM 2026/);

  const d = r.days["2026-11-02"];
  assert.ok(d, "2 Kasım olmalı");
  assert.deepEqual(d.meals.ogle.items.map((i) => i.name), [
    "Yeşil Mercimek Çorba",
    "Barbekü Soslu Tavuk",
    "Soslu Makarna",
    "Coleslaw",
  ]);
  assert.deepEqual(d.meals.ogle.items.map((i) => i.kcal), [200, 601, 456, 107]);
  assert.equal(d.meals.ogle.totalKcal, 1364);
  assert.equal(d.meals.ogle.items[0].category, "ÇORBA");
  assert.equal(d.meals.ogle.items[1].category, "ANA YEMEK");

  // Tüm günler Kasım 2026'da, hafta içi ve geçerli
  for (const iso of Object.keys(r.days)) {
    assert.ok(isValidISO(iso) && iso.startsWith("2026-11-"), iso);
    const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
    assert.ok(wd >= 1 && wd <= 5, `${iso} hafta sonu`);
  }
  // Kaynaktaki hatalı satır (30 EKİM yazıyor) yayımlanmamalı ve uyarı üretmeli
  assert.equal(r.days["2026-10-30"], undefined);
  assert.ok(r.issues.some((m) => m.includes("2026-10-30")));
});

test("Ankü: ZIP olmayan içerik tanınır", () => {
  assert.equal(isZip(Buffer.from("<!doctype html><html>")), false);
  assert.throws(() => parseAnkuXlsx(Buffer.from("PK\u0003\u0004bozuk")));
});

test("Yardımcılar", () => {
  assert.equal(excelSerialToISO(46328), "2026-11-02");
  assert.equal(excelSerialToISO(5), null);
  assert.equal(niceTurkish("İSVEÇ KÖFTE/SEBZE GARNİTÜR"), "İsveç Köfte / Sebze Garnitür");
  assert.equal(niceTurkish("ŞEHRİYELİ PİRİNÇ PİLAVI"), "Şehriyeli Pirinç Pilavı");
  assert.equal(isValidISO("2026-11-31"), false);
});
