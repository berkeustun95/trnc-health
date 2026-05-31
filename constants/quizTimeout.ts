export function calculateTimeoutAt(now: Date = new Date()): Date {
  const day = now.getDay() // 0=Sun..6=Sat
  const totalMins = now.getHours() * 60 + now.getMinutes()

  const OPEN      = 8 * 60 + 30   // 08:30
  const CLOSE_WD  = 17 * 60 + 30  // 17:30
  const CLOSE_SAT = 13 * 60 + 30  // 13:30

  const addMins = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)
  const nextDayAt9 = (d: Date, ahead: number): Date => {
    const r = new Date(d); r.setDate(r.getDate() + ahead); r.setHours(9, 0, 0, 0); return r
  }
  const sameDay9 = (d: Date): Date => {
    const r = new Date(d); r.setHours(9, 0, 0, 0); return r
  }

  if (day === 0) return nextDayAt9(now, 1)                               // Sunday → Mon 09:00
  if (day === 6) {
    if (totalMins >= OPEN && totalMins < CLOSE_SAT) return addMins(now, 30) // Sat 08:30–13:30 → +30 min
    if (totalMins < OPEN)                            return sameDay9(now)    // Sat before 08:30 → Sat 09:00
    return nextDayAt9(now, 2)                                               // Sat after 13:30 → Mon 09:00
  }
  // Weekday Mon–Fri
  if (totalMins >= OPEN && totalMins < CLOSE_WD) return addMins(now, 30) // Within hours → +30 min
  if (totalMins < OPEN)                          return sameDay9(now)     // Before 08:30 → same day 09:00
  return nextDayAt9(now, 1)                                               // After 17:30 → next day 09:00
}
