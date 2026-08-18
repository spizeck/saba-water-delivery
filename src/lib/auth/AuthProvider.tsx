"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getFirebaseAuth, isFirebaseClientConfigured } from "@/lib/firebase/client";

interface AuthContextValue {
  /** The signed-in Firebase user, or null if signed out. */
  user: User | null;
  /** True while the initial auth state is still being determined. */
  loading: boolean;
  /** False when Firebase has not been configured for this environment. */
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isConfigured: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseClientConfigured);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isConfigured: isFirebaseClientConfigured }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
