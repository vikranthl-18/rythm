/** Age in whole years from a YYYY-MM-DD birthday, or null if invalid. */
export function ageFromBirthday(birthday: string): number | null {
  const d = new Date(birthday + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** The age range the app's engines support. */
export function isSupportedAge(age: number): boolean {
  return age >= 13 && age <= 100;
}

/** Default birthdate that yields exactly `age` years today (for demos). */
export function birthdayForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  // Build the string from LOCAL date parts — toISOString() is UTC and can
  // roll the day (and thus the age) when the local timezone is offset from
  // UTC, e.g. 22:00 in UTC-7 is already "tomorrow" in UTC.
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
