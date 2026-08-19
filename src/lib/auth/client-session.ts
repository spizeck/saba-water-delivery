"use client";

export type EstablishSessionResult =
  | { roles: string[]; portal: string; created: boolean }
  | { error: string };

/**
 * Exchanges a Firebase client ID token for an httpOnly session cookie.
 *
 * `intendedPortal` is an optional, user-explicit destination chosen on the
 * homepage. It is validated server-side to avoid open redirects.
 *
 * Returns `created: true` when this call provisioned a brand-new user
 * profile; `created: false` for returning users.
 */
export async function establishSession(
  idToken: string,
  intendedPortal: string | null = null,
): Promise<EstablishSessionResult> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, intendedPortal }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { error: data.error ?? "Sign-in failed." };
    }
    return { roles: data.roles, portal: data.portal, created: data.created };
  } catch {
    return { error: "Could not reach the server. Check your connection and try again." };
  }
}

/** Clears the server's session cookie. Does not sign out of Firebase itself. */
export async function clearSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" });
}
