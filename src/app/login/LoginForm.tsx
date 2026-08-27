"use client";

import {
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { establishSession, type EstablishSessionResult } from "@/lib/auth/client-session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getFirebaseAuth } from "@/lib/firebase/client";

type Mode = "sign-in" | "create-account";

type SessionStep =
  | "idle"
  | "establishing"
  | "ready"
  | "error";

interface LoginFormProps {
  intendedPortal: string | null;
}

export function LoginForm({ intendedPortal }: LoginFormProps) {
  const router = useRouter();
  const { user, loading, isConfigured } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionStep, setSessionStep] = useState<SessionStep>("idle");
  const [sessionResult, setSessionResult] = useState<Extract<
    EstablishSessionResult,
    { portal: string }
  > | null>(null);
  const establishing = useRef(false);

  // Once Firebase reports a signed-in user (fresh sign-in or a persisted
  // session from a previous visit), exchange it for a server session
  // cookie and route to the portal requested on the home page.
  useEffect(() => {
    if (loading || !user || establishing.current || sessionStep !== "idle") return;
    establishing.current = true;
    void (async () => {
      setError(null);
      setSessionStep("establishing");
      try {
        const idToken = await user.getIdToken();
        const result = await establishSession(idToken, intendedPortal);
        if ("error" in result) {
          if (result.error === "DRIVER_ACCESS_DENIED") {
            router.replace("/access-denied?reason=driver");
            return;
          }
          setError(result.error);
          setSessionStep("error");
          return;
        }
        setSessionResult(result);
        setSessionStep("ready");
      } finally {
        establishing.current = false;
      }
    })();
  }, [loading, user, router, intendedPortal, sessionStep]);

  // Navigate once the session has been established and any messaging state
  // has been set. The brief paint of the final message is intentional; no
  // extra delay is added.
  useEffect(() => {
    if (sessionStep === "ready" && sessionResult) {
      router.replace(`/${sessionResult.portal}`);
    }
  }, [sessionStep, sessionResult, router]);

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

  if (user && sessionStep !== "idle") {
    if (sessionStep === "error") {
      return (
        <Card>
          <h1 className="text-xl font-bold text-slate-900">Couldn&apos;t finish signing in</h1>
          <p className="mt-2 text-slate-600">{error}</p>
        </Card>
      );
    }

    if (sessionStep === "ready" && sessionResult) {
      const isNew = sessionResult.created;
      return (
        <Card>
          <h1 className="text-xl font-bold text-slate-900">
            {isNew ? "Setting up your account\u2026" : "Signing you in\u2026"}
          </h1>
          <p className="mt-2 text-slate-600">
            {isNew
              ? "Creating your Saba Water Delivery profile."
              : `Signing in as ${user.email ?? user.uid}.`}
          </p>
        </Card>
      );
    }

    return (
      <Card>
        <h1 className="text-xl font-bold text-slate-900">Signing you in&hellip;</h1>
        <p className="mt-2 text-slate-600">
          Please wait while we securely sign you in.
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

      {intendedPortal === "driver" && (
        <p className="mt-2 text-sm text-slate-600">
          This sign-in is for authorized drivers with a linked Driver Registry account.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={submitting}
          onClick={() => handleProviderSignIn(new GoogleAuthProvider())}
        >
          Continue with Google
        </Button>
        <div className="relative">
          <Button
            variant="outline"
            size="lg"
            disabled
            aria-disabled="true"
            aria-label="Facebook login will be available soon."
            className="w-full opacity-50 cursor-not-allowed"
          >
            Continue with Facebook
          </Button>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">
            Coming Soon
          </span>
        </div>
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
