export const REQUEST_NOTES_MAX_LENGTH = 1000;

export function normalizeRequestNotes(value: unknown): string | null {
  const notes = typeof value === "string" ? value.trim() : "";
  if (notes.length > REQUEST_NOTES_MAX_LENGTH) {
    throw new Error("REQUEST_NOTES_TOO_LONG");
  }
  return notes || null;
}
