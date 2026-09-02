"use client";

import Link from "next/link";

import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/layout/Logo";
import { PWA_INSTALL_PATHS, PWA_PORTAL_PATHS, type PwaPortal } from "@/lib/pwa/constants";

import { usePwaInstall } from "./usePwaInstall";

interface InstallPromptProps {
  portal: PwaPortal;
  title: string;
  portalName: string;
}

export function InstallPrompt({ portal, title, portalName }: InstallPromptProps) {
  const { state, invokeInstall, dismissed, isStandalone } = usePwaInstall(portal);
  const portalPath = PWA_PORTAL_PATHS[portal];

  if (state.kind === "loading") {
    return (
      <Card className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Logo className="relative h-10 w-10" alt="Saba Water Delivery" />
        </div>
        <p className="mt-4 text-slate-600">Checking install options…</p>
      </Card>
    );
  }

  return (
    <Card className="text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-50">
        <Logo className="relative h-14 w-14" alt="Saba Water Delivery" />
      </div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-600">
        Add {portalName} to your home screen for the fastest way to request and manage water
        deliveries.
      </p>

      {isStandalone && (
        <div className="mt-6">
          <p className="mb-4 text-sm font-medium text-green-700">
            You are already using the app from your home screen.
          </p>
          <LinkButton href={portalPath} size="lg" className="w-full justify-center sm:w-auto">
            Open {portalName}
          </LinkButton>
        </div>
      )}

      {!isStandalone && state.kind === "prompt" && (
        <div className="mt-6 space-y-3">
          <Button size="lg" className="w-full justify-center sm:w-auto" onClick={invokeInstall}>
            Install {portalName}
          </Button>
          {dismissed && (
            <p className="text-sm text-slate-500">
              Install prompt was dismissed. You can still install later from your browser menu.
            </p>
          )}
          <div>
            <LinkButton
              href={portalPath}
              variant="outline"
              size="lg"
              className="w-full justify-center sm:w-auto"
            >
              Continue to {portalName}
            </LinkButton>
          </div>
        </div>
      )}

      {!isStandalone && state.kind === "ios" && (
        <div className="mt-6 space-y-4 text-left">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="font-semibold text-slate-900">Install on iPhone or iPad</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>Open this page in Safari.</li>
              <li>
                Tap the <strong>Share</strong> button{" "}
                <span aria-hidden="true">□</span> at the bottom of the screen.
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong> in the top-right corner.
              </li>
            </ol>
          </div>
          <p className="text-sm text-slate-500">
            iOS requires Safari for the standard Add to Home Screen flow. If you are using another
            browser, switch to Safari first.
          </p>
          <LinkButton
            href={portalPath}
            variant="outline"
            size="lg"
            className="w-full justify-center sm:w-auto"
          >
            Continue to {portalName}
          </LinkButton>
        </div>
      )}

      {!isStandalone && (state.kind === "unsupported" || state.kind === "standalone") && (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-slate-500">
            This browser does not offer an automatic install prompt. Use your browser&apos;s menu to
            add this page to your home screen, or continue below.
          </p>
          <LinkButton
            href={portalPath}
            variant="outline"
            size="lg"
            className="w-full justify-center sm:w-auto"
          >
            Continue to {portalName}
          </LinkButton>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Having trouble?{" "}
        <Link href={PWA_INSTALL_PATHS[portal === "driver" ? "resident" : "driver"]} className="underline">
          Try the {portal === "driver" ? "resident" : "driver"} install page instead
        </Link>
        .
      </p>
    </Card>
  );
}
