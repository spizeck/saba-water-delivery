export function safeResidentReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://saba-water-delivery.invalid");
    if (url.origin !== "https://saba-water-delivery.invalid") return null;

    if (/^\/resident\/review\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) {
      return !url.search && !url.hash ? url.pathname : null;
    }
    if (url.pathname !== "/resident") return null;

    const requestId = url.searchParams.get("requestId");
    if (requestId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "requestId")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
