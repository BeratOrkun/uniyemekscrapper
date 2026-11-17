// Gazi Google Sheet ayrıştırıcı testleri.  Çalıştır: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCSV, parseGaziCsv, parseDateCell } from "../src/gazi.mjs";

const csv = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("Gazi: gerçek sheet (Kasım 2026) eksiksiz ayrıştırılır", () => {
  const { days, issues } = parseGaziCsv(csv("gazi-2026-11.csv"));
  const isos = Object.keys(days).sort();
  assert.equal(isos.length, 25);
  assert.equal(isos[0], "2026-11-02");
  assert.equal(isos.at(-1), "2026-12-04");
  assert.deepEqual(issues, []);
  for (const iso of isos) {
    const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
    assert.ok(wd >= 1 && wd <= 5, `${iso} hafta içi olmalı`);
    const ogle = days[iso].meals.ogle;
    assert.equal(ogle.items.length, 5, iso);
    assert.ok(ogle.totalKcal > 0, iso);
  }
  const d = days["2026-11-17"].meals.ogle;
  assert.deepEqual(d.items.map((i) => i.name), [
    "Mercimek Çorbası", "Tavuklu Çökertme Kebabı", "Etsiz Kabak Yemeği", "Nohutlu Pirinç Pilavı", "Kemal Paşa Tatlısı",
  ]);
  assert.deepEqual(d.items.map((i) => i.category), [
    "ÇORBA", "ANA YEMEK", "ETSİZ ALTERNATİF", "YARDIMCI YEMEK", "TATLI / YANINDA",
  ]);
  assert.equal(d.totalKcal, 1250);
  assert.equal(days["2026-12-02"].meals.ogle.items[3].name, "Soslu makarna");
});

test("Gazi: tatil, çakışma, yanlış gün adı ve geçersiz tarih", () => {
  const { days, issues } = parseGaziCsv(csv("gazi-uc-durumlar.csv"));
  // Aynı tarihe iki farklı menü → yayımlanmaz
  assert.ok(days["2026-12-07"].invalid);
  assert.deepEqual(days["2026-12-07"].meals, {});
  // Resmi tatil
  assert.equal(days["2026-12-08"].holiday.text, "RESMİ TATİL");
  assert.deepEqual(days["2026-12-08"].meals, {});
  // Hücre içi virgül
  assert.equal(days["2026-12-09"].meals.ogle.items[0].name, "Tavuk, Pilav");
  // Etsiz alternatif
  assert.equal(days["2026-12-10"].meals.ogle.items[2].category, "ETSİZ ALTERNATİF");
  assert.equal(days["2026-12-10"].meals.ogle.totalKcal, 1100);
  // Boş sütun yayımlanmaz
  assert.equal(days["2026-12-11"], undefined);
  // 14 Aralık 2026 Pazartesi'dir; "Salı" yazıyor → geçersiz
  assert.ok(days["2026-12-14"].invalid);
  // 31 Kasım diye bir gün yok
  assert.ok(issues.some((m) => m.includes("31 Kasım")));
  // Yılbaşı
  assert.match(days["2027-01-01"].holiday.text, /Resmi Tatil/);
});

test("Gazi: bozuk / beklenmeyen içerik reddedilir", () => {
  assert.throws(() => parseGaziCsv("<!DOCTYPE html><html>Giriş yap</html>"), /HTML/);
  assert.throws(() => parseGaziCsv("a,b,c\n1,2,3\n"), /tarih bulunamadı/);
  assert.throws(() => parseGaziCsv(""), /tarih bulunamadı/);
});

test("Gazi: CSV ve tarih yardımcıları", () => {
  assert.deepEqual(parseCSV('a,"b, c","d ""e"""\n'), [["a", "b, c", 'd "e"']]);
  assert.equal(parseDateCell("2 Kasim 2026 Pazartesi").iso, "2026-11-02");
  assert.equal(parseDateCell("02.11.2026").iso, "2026-11-02");
  assert.equal(parseDateCell("2 Kasım 2026 Salı").weekdayOk, false);
  assert.equal(parseDateCell("Mercimek Çorbası"), null);
});

test("Şema doğrulaması: tatil ve geçersiz günler kabul edilir, bozuk veri reddedilir", async () => {
  const { validateDays } = await import("../src/validate.mjs");
  const { days } = parseGaziCsv(csv("gazi-uc-durumlar.csv"));
  assert.deepEqual(validateDays(days), []);
  assert.deepEqual(validateDays(parseGaziCsv(csv("gazi-2026-11.csv")).days), []);
  // Bozuk örnekler
  assert.ok(validateDays({ "2026-11-31": { date: "2026-11-31", meals: {} } }).length);
  assert.ok(validateDays({ "2026-11-20": { date: "2026-11-21", meals: {} } }).length);
  assert.ok(validateDays({ "2026-11-20": { date: "2026-11-20", meals: {} } }).length, "ne menü ne işaret");
  assert.ok(validateDays({ "2026-11-20": { date: "2026-11-20", meals: { ogle: { items: [{ name: "" }] } } } }).length);
  assert.ok(validateDays({ "2026-11-20": { date: "2026-11-20", holiday: { text: "Tatil" }, meals: { ogle: { items: [{ name: "X" }] } } } }).length);
});
