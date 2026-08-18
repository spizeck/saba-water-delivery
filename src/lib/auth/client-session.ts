"use client";

export type EstablishSessionResult =
  | { roles: string[]; portal: string }
  | { error: string };

/** Exchanges a Firebase ID token for the server's httpOnly session cookie. */
export async function establishSession(idToken: string): Promise<EstablishSessionResult> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { error: data.error ?? "Sign-in failed." };
    }
    return { roles: data.roles, portal: data.portal };
  } catch {
    return { error: "Could not reach the server. Check your connection and try again." };
  }
}

/** Clears the server's session cookie. Does not sign out of Firebase itself. */
export async function clearSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" });
}
