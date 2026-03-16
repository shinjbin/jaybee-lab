const { cleanupText } = require("./utils");

function parseDateInput(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function getSeoulDateParts(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(value);
  const entries = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(entries.year),
    month: Number(entries.month),
    day: Number(entries.day),
    hour: Number(entries.hour),
    minute: Number(entries.minute),
    second: Number(entries.second)
  };
}

function toSeoulDateString(value = new Date()) {
  const parts = getSeoulDateParts(value);

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isWithinSeoulTimeWindow(startHour, endHour, value = new Date()) {
  const parts = getSeoulDateParts(value);
  const minutes = parts.hour * 60 + parts.minute;
  const startMinutes = Number(startHour) * 60;
  const endMinutesExclusive = (Number(endHour) + 1) * 60;

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutesExclusive)) {
    return false;
  }

  return minutes >= startMinutes && minutes < endMinutesExclusive;
}

function formatDateLabel(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return cleanupText(String(value));
  }

  return toSeoulDateString(date);
}

module.exports = {
  parseDateInput,
  toSeoulDateString,
  formatDateLabel,
  getSeoulDateParts,
  isWithinSeoulTimeWindow
};
