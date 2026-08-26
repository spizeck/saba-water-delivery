/**
 * Display-only phone formatter.
 *
 * This is intentionally simple: it formats a stored phone number for
 * human readability but never changes the canonical value used for
 * matching/normalization (see `src/lib/whatsapp/phoneMatching.ts`). It
 * is not a validation library.
 */

export function formatPhoneForDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return trimmed;

  if (hasPlus) {
    // North America: +1 NXX NXX XXXX (11 total digits including country code).
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }

    // Saba / Caribbean Netherlands: +599 XXX XXXX (10 total digits).
    if (digits.length === 10 && digits.startsWith("599")) {
      return `+599 ${digits.slice(3, 6)} ${digits.slice(6)}`;
    }

    // Fallback: keep the plus and group digits 3-3-... from the left.
    const groups = [];
    let i = 0;
    while (i < digits.length) {
      const remaining = digits.length - i;
      const chunkSize = remaining <= 4 ? remaining : 3;
      groups.push(digits.slice(i, i + chunkSize));
      i += chunkSize;
    }
    return `+${groups.join(" ")}`;
  }

  // Plain 10-digit number without a leading plus.
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  // Otherwise return the original (trimmed) string unchanged.
  return trimmed;
}
