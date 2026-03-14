const { cleanupText } = require("./utils");

function parseDateInput(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function toSeoulDateString(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(value);
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
  formatDateLabel
};
