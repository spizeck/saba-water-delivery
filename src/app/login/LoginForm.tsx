"use client";

import {
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getFirebaseAuth } from "@/lib/firebase/client";

type Mode = "sign-in" | "create-account";

export function LoginForm() {
  const { user, loading, isConfigured } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isConfigured) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <h1 className="text-xl font-bold text-slate-900">Sign-in is not configured yet</h1>
        <p className="mt-2 text-slate-700">
          This environment is missing Firebase configuration. Set the{" "}
          <code className="rounded bg-white px-1 py-0.5 text-sm">NEXT_PUBLIC_FIREBASE_*</code>{" "}
          environment variables described in <code className="rounded bg-white px-1 py-0.5 text-sm">.env.example</code>{" "}
          to enable Google, Facebook, and email/password sign-in.
        </p>
      </Card>
    );
  }

  if (loading) {
    return <Card>Loading&hellip;</Card>;
  }

  if (user) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-slate-900">You&apos;re signed in</h1>
        <p className="mt-2 text-slate-600">
          Signed in as {user.email ?? user.uid}. Role-based routing to the
          resident, driver, and dispatcher/admin portals will be added once
          user profiles and roles are implemented.
        </p>
      </Card>
    );
  }

  async function handleProviderSignIn(provider: GoogleAuthProvider | FacebookAuthProvider) {
    setError(null);
    const auth = getFirebaseAuth();
    if (!auth) return;
    try {
      setSubmitting(true);
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const auth = getFirebaseAuth();
    if (!auth) return;
    try {
      setSubmitting(true);
      if (mode === "sign-in") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-bold text-slate-900">Log in</h1>

      <div className="mt-4 flex flex-col gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={submitting}
          onClick={() => handleProviderSignIn(new GoogleAuthProvider())}
        >
          Continue with Google
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={submitting}
          onClick={() => handleProviderSignIn(new FacebookAuthProvider())}
        >
          Continue with Facebook
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3 text-sm text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        or
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleEmailSubmit}>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={submitting}>
          {mode === "sign-in" ? "Log in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm font-medium text-blue-700 hover:underline"
        onClick={() => setMode(mode === "sign-in" ? "create-account" : "sign-in")}
      >
        {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Log in"}
      </button>
    </Card>
  );
}
