// Yazmadan önce her veri dosyası bu şemadan geçer; hata varsa dosya YAZILMAZ.
import { isValidISO } from "./parsers.mjs";

export function validateDays(days) {
  const errors = [];
  if (!days || typeof days !== "object" || Array.isArray(days)) return ["days nesne değil"];
  for (const [iso, day] of Object.entries(days)) {
    if (!isValidISO(iso)) errors.push(`geçersiz tarih anahtarı ${iso}`);
    if (!day || day.date !== iso) errors.push(`${iso}: date alanı anahtarla uyuşmuyor`);
    const meals = day?.meals;
    if (!meals || typeof meals !== "object") {
      errors.push(`${iso}: meals yok`);
      continue;
    }
    const mealCount = Object.values(meals).filter((m) => m?.items?.length).length;
    if (day.holiday && typeof day.holiday.text !== "string") errors.push(`${iso}: holiday.text yok`);
    if (day.invalid && typeof day.invalid.reason !== "string") errors.push(`${iso}: invalid.reason yok`);
    if (!mealCount && !day.holiday && !day.invalid) errors.push(`${iso}: ne menü ne tatil/geçersiz işareti var`);
    if (mealCount && (day.holiday || day.invalid)) errors.push(`${iso}: hem menü hem tatil/geçersiz işareti var`);
    for (const [key, meal] of Object.entries(meals)) {
      if (!Array.isArray(meal?.items)) errors.push(`${iso}/${key}: items dizi değil`);
      else if (meal.items.length > 40) errors.push(`${iso}/${key}: şüpheli sayıda yemek (${meal.items.length})`);
      else
        meal.items.forEach((it, i) => {
          if (typeof it?.name !== "string" || !it.name.trim() || it.name.length > 160) {
            errors.push(`${iso}/${key}[${i}]: geçersiz yemek adı`);
          }
        });
    }
  }
  return errors;
}
