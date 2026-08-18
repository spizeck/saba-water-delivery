"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";

import { toggleAvailability, type AvailabilityActionState } from "./actions";

const initialState: AvailabilityActionState = { status: "idle" };

interface Props {
  currentStatus: "online" | "offline";
}

export function AvailabilityToggle({ currentStatus }: Props) {
  const [state, formAction, pending] = useActionState(toggleAvailability, initialState);
  const isOnline = currentStatus === "online";
  const nextStatus = isOnline ? "offline" : "online";

  return (
    <form action={formAction}>
      <input type="hidden" name="availabilityStatus" value={nextStatus} />
      <Button
        type="submit"
        variant={isOnline ? "outline" : "primary"}
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending
          ? "Updating\u2026"
          : isOnline
            ? "Go Offline"
            : "Go Online"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
