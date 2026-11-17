// Duty-swap push text per recipient language (keys are the full English names, as in constants/i18n.js LANGUAGES).
// Values are copied verbatim from notifDutySwapTitle / notifDutySwapBody; scripts/check-admin-push-strings.mjs fails on any difference.
export const DUTY_SWAP = {
  English: { title: "💊 Duty pharmacy updated", body: "{name} is now the duty pharmacy for {date}." },
  Turkish: { title: "💊 Nöbetçi eczane güncellendi", body: "{date} tarihinde nöbetçi eczane {name} oldu." },
  Arabic: { title: "💊 تم تحديث صيدلية المناوبة", body: "{name} هي صيدلية المناوبة بتاريخ {date}." },
  Russian: { title: "💊 Дежурная аптека обновлена", body: "{name} теперь дежурная аптека на {date}." },
  Greek: { title: "💊 Εφημερεύον φαρμακείο ενημερώθηκε", body: "Το {name} είναι το εφημερεύον φαρμακείο για {date}." },
  French: { title: "💊 Pharmacie de garde mise à jour", body: "{name} est la pharmacie de garde pour le {date}." },
  Spanish: { title: "💊 Farmacia de guardia actualizada", body: "{name} es ahora la farmacia de guardia para el {date}." },
  German: { title: "💊 Notdienstapotheke aktualisiert", body: "{name} ist jetzt die Notdienstapotheke für den {date}." },
  Persian: { title: "💊 داروخانه نوبتی به‌روز شد", body: "{name} اکنون داروخانه نوبتی برای {date} است." },
}

export function dutySwapText(lang) {
  return Object.hasOwn(DUTY_SWAP, lang) ? DUTY_SWAP[lang] : DUTY_SWAP.English
}
