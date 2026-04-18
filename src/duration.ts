/**
 * Shared duration parsing helpers for user-facing config and command inputs.
 *
 * Supports compact duration strings like `500ms`, `30s`, `15m`, `1h`, and `2d`.
 */

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/u;

export const parseDuration = (value: string): number | null => {
  const trimmed = value.trim().toLowerCase();
  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
  }

  return null;
};
