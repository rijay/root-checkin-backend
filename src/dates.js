const DAY_MS = 24 * 60 * 60 * 1000;
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function toChinaParts(date = new Date()) {
  return new Date(date.getTime() + CN_OFFSET_MS).toISOString();
}

function todayISO(date = new Date()) {
  return toChinaParts(date).slice(0, 10);
}

function nowISO(date = new Date()) {
  const text = toChinaParts(date);
  return `${text.slice(0, 19)}+08:00`;
}

function asUtcDay(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(dateText, days) {
  const date = new Date(asUtcDay(dateText) + days * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function daysBetween(startDate, endDate) {
  return Math.floor((asUtcDay(endDate) - asUtcDay(startDate)) / DAY_MS);
}

module.exports = {
  addDays,
  daysBetween,
  nowISO,
  todayISO,
};
