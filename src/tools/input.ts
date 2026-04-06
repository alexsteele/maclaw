// Shared helpers for parsing model-provided tool input objects.

export const parseObjectInput = (input: unknown): Record<string, unknown> => {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Expected an object input.");
  }

  return input as Record<string, unknown>;
};

export const parseEmptyInput = (input: unknown): void => {
  const object = parseObjectInput(input);
  if (Object.keys(object).length > 0) {
    throw new Error("This tool does not accept any input.");
  }
};

export const requiredString = (object: Record<string, unknown>, name: string): string => {
  const value = object[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected "${name}" to be a non-empty string.`);
  }

  return value.trim();
};
