// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Full UTC years elapsed between startISO ("YYYY-MM-DD") and `today`.
// The count rolls over on the anniversary day itself.
export function yearsOfExperience(startISO, today) {
  const m = ISO_DATE.exec(startISO);
  if (!m) throw new Error(`Invalid start date "${startISO}": expected YYYY-MM-DD`);
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);

  // Round-trip through Date.UTC so impossible dates such as 2009-13-40 or 2009-02-30 are rejected.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid start date "${startISO}": not a real calendar date`);
  }

  let years = today.getUTCFullYear() - year;
  const tm = today.getUTCMonth() + 1, td = today.getUTCDate();
  if (tm < month || (tm === month && td < day)) years -= 1;
  return years;
}
