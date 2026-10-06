import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  chipActionClasses,
  choiceControlClasses,
  focusVisibleClasses,
  iconButtonClasses,
  interactiveTransitionClasses,
  navPillClasses,
  pressClasses,
  selectableRowClasses,
  textActionClasses,
} from "@/lib/utils/interactive";

/**
 * Contract tests for the shared interaction vocabulary — see DEVIN.md
 * "Interaction feedback". These assert the *behaviors* the vocabulary
 * guarantees (press feedback, reduced-motion safety, focus visibility,
 * inert busy/disabled states), not the full class lists, so legitimate
 * tuning stays free.
 */

function classOf(el: ReactElement): string {
  return (el.props as { className?: string }).className ?? "";
}

function childrenOf(el: ReactElement): ReactNode[] {
  const children = (el.props as { children?: ReactNode }).children;
  return Array.isArray(children) ? children : [children];
}

describe("shared interaction vocabulary", () => {
  it("press feedback depresses on :active and fully resets under reduced motion", () => {
    expect(pressClasses).toContain("active:scale-");
    // Both transform resets are required: scale and translate are
    // independent CSS properties in Tailwind v4.
    expect(pressClasses).toContain("motion-reduce:active:scale-100");
    expect(pressClasses).toContain("motion-reduce:active:translate-y-0");
  });

  it("the shared transition is short and removed under reduced motion", () => {
    expect(interactiveTransitionClasses).toContain("duration-150");
    expect(interactiveTransitionClasses).toContain(
      "motion-reduce:transition-none",
    );
  });

  it("every interactive recipe keeps a visible focus state and pointer affordance", () => {
    for (const recipe of [
      chipActionClasses,
      navPillClasses,
      selectableRowClasses,
      iconButtonClasses,
      textActionClasses,
    ]) {
      expect(recipe).toMatch(/focus-visible:(outline|ring)/);
    }
    for (const recipe of [
      chipActionClasses,
      navPillClasses,
      selectableRowClasses,
      iconButtonClasses,
      textActionClasses,
      choiceControlClasses,
    ]) {
      expect(recipe).toContain("cursor-pointer");
    }
  });

  it("button-like recipes share the same focus ring as the primary Button", () => {
    for (const recipe of [
      chipActionClasses,
      navPillClasses,
      iconButtonClasses,
    ]) {
      expect(recipe).toContain(focusVisibleClasses);
    }
  });
});

describe("Button interaction contract", () => {
  it("renders tactile press feedback and the shared focus ring", () => {
    const el = Button({ children: "Save" }) as ReactElement;
    const cls = classOf(el);
    expect(cls).toContain("active:scale-[0.98]");
    expect(cls).toContain("active:translate-y-px");
    expect(cls).toContain("motion-reduce:active:scale-100");
    expect(cls).toContain("focus-visible:outline-blue-700");
    expect(cls).toContain("cursor-pointer");
  });

  it("loading disables the control, marks it busy, and renders a spinner", () => {
    const el = Button({ children: "Save", loading: true }) as ReactElement;
    const props = el.props as {
      disabled?: boolean;
      "aria-busy"?: boolean;
    };
    expect(props.disabled).toBe(true);
    expect(props["aria-busy"]).toBe(true);
    // The spinner is an inline component element preceding the label —
    // when not loading, children is only the label node.
    const spinner = childrenOf(el).find(
      (c) => typeof c === "object" && c !== null,
    ) as ReactElement | undefined;
    expect(spinner).toBeDefined();
    // Rendering the spinner component yields the svg, which must not
    // animate under prefers-reduced-motion.
    const svg = (spinner!.type as (p: unknown) => ReactElement)(
      {},
    ) as ReactElement;
    expect(classOf(svg)).toContain("motion-reduce:animate-none");
  });

  it("a plain disabled button is inert without implying progress", () => {
    const el = Button({ children: "Save", disabled: true }) as ReactElement;
    const props = el.props as {
      disabled?: boolean;
      "aria-busy"?: boolean;
    };
    expect(props.disabled).toBe(true);
    expect(props["aria-busy"]).toBeUndefined();
    const hasSpinner = childrenOf(el).some(
      (c) => typeof c === "object" && c !== null,
    );
    expect(hasSpinner).toBe(false);
  });

  it("preserves caller-supplied classes and attributes", () => {
    const el = Button({
      children: "Save",
      className: "w-full",
      "aria-label": "Save settings",
    }) as ReactElement;
    expect(classOf(el)).toContain("w-full");
    expect((el.props as Record<string, unknown>)["aria-label"]).toBe(
      "Save settings",
    );
  });
});

describe("Card", () => {
  it("forwards HTML attributes such as aria-labelledby to the div", () => {
    const el = Card({
      children: "Body",
      "aria-labelledby": "help-heading",
    }) as ReactElement;
    expect((el.props as Record<string, unknown>)["aria-labelledby"]).toBe(
      "help-heading",
    );
  });
});
