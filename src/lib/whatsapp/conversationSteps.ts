/**
 * PURE conversation state machine for resident WhatsApp ordering — see
 * PRODUCT.md / TECHNICAL.md "WhatsApp Resident Ordering". No Firestore
 * access, no network calls, no `server-only` guard — everything needed
 * is passed in via `session`/`inboundText`/`context`, so this module is
 * fully unit-testable (see DEVIN.md "Integration Boundaries").
 *
 * This function decides the NEXT session state, what to say, and
 * (optionally) a single canonical domain ACTION to perform — it never
 * performs the action itself. The server-only orchestrator
 * (`handleIncomingMessage.ts`) executes the action via the exact same
 * domain functions the web app uses (`createWaterRequest()`,
 * `confirmWaterDelivery()`, etc.) and appends the real success/failure
 * message, since only the orchestrator knows whether the action
 * actually succeeded.
 *
 * Deterministic only: every step recognizes a narrow, explicit set of
 * replies (a menu number, CONFIRM/CANCEL, etc.) and re-prompts on
 * anything else. No AI/intent classification.
 */

import * as m from "./messages";
import {
  isCancelKeyword,
  isConfirmKeyword,
  isGreeting,
  parseAvailableStorage,
  parseMenuNumber,
  parsePersonsAffected,
  parseUrgencyChoice,
  parseVillageChoice,
  parseVulnerableCircumstances,
} from "./parsing";
import type {
  WhatsAppConversationContext,
  WhatsAppConversationResult,
  WhatsAppSession,
} from "./types";

function withSession(
  session: WhatsAppSession,
  patch: Partial<WhatsAppSession>,
): WhatsAppSession {
  return { ...session, ...patch, draft: { ...session.draft, ...patch.draft } };
}

function resetToMenu(session: WhatsAppSession): WhatsAppSession {
  return { ...session, step: "menu", draft: {} };
}

function preferredDriverName(
  context: WhatsAppConversationContext,
  preferredDriverId: string | null,
): string | null {
  if (!preferredDriverId) return null;
  return context.eligibleDrivers.find((d) => d.uid === preferredDriverId)?.displayName ?? null;
}

function handleMenu(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const choice = parseMenuNumber(text);

  if (choice === null) {
    return { session, outbound: [isGreeting(text) ? m.WELCOME_MENU : m.UNRECOGNIZED_MENU_CHOICE] };
  }

  if (session.customerType === "ambiguous") {
    return { session, outbound: [m.AMBIGUOUS_IDENTITY_MESSAGE] };
  }

  if (choice === 1) {
    // Request 1,000 gallons of water.
    if (context.activeRequest) {
      return {
        session,
        outbound: [
          m.DUPLICATE_ACTIVE_REQUEST_MESSAGE,
          m.requestStatusMessage(context.activeRequest.status, context.activeRequest.dispatchPriority),
        ],
      };
    }
    if (session.customerType === "registered" && context.registeredProfile) {
      const profile = context.registeredProfile;
      return {
        session: withSession(session, {
          step: "confirm_profile",
          draft: { displayName: profile.displayName },
        }),
        outbound: [m.confirmProfileMessage(profile)],
      };
    }
    // Unregistered (or identity not yet determined) — collect from scratch.
    return {
      session: withSession(session, { step: "collect_name" }),
      outbound: [m.ASK_NAME],
    };
  }

  if (choice === 2) {
    // Check my current request.
    if (session.customerType !== "registered") {
      return { session, outbound: [m.AMBIGUOUS_IDENTITY_MESSAGE] };
    }
    if (!context.activeRequest) {
      return { session, outbound: [m.NO_ACTIVE_REQUEST_MESSAGE] };
    }
    const statusMsg = m.requestStatusMessage(
      context.activeRequest.status,
      context.activeRequest.dispatchPriority,
    );
    if (context.activeRequest.status === "delivered") {
      return {
        session: withSession(session, {
          step: "confirm_delivery",
          draft: { activeRequestId: context.activeRequest.id },
        }),
        outbound: [statusMsg, m.DELIVERY_CONFIRMATION_PROMPT],
      };
    }
    return { session, outbound: [statusMsg] };
  }

  return { session, outbound: [m.UNRECOGNIZED_MENU_CHOICE] };
}

function handleConfirmProfile(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const choice = parseMenuNumber(text);
  const profile = context.registeredProfile;

  if (choice === 1 && profile) {
    return {
      session: withSession(session, {
        step: "collect_persons_affected",
        draft: {
          displayName: profile.displayName,
          phone: profile.phone ?? session.senderPhone,
          village: profile.village ?? undefined,
          deliveryDirections: profile.deliveryDirections ?? undefined,
          editingProfile: false,
        },
      }),
      outbound: [m.ASK_PERSONS_AFFECTED],
    };
  }

  if (choice === 2) {
    return {
      session: withSession(session, { step: "collect_village", draft: { editingProfile: true } }),
      outbound: [m.ASK_VILLAGE],
    };
  }

  return { session, outbound: [profile ? m.confirmProfileMessage(profile) : m.UNRECOGNIZED_MENU_CHOICE] };
}

function handleCollectName(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const name = text.trim();
  if (!name) return { session, outbound: [m.ASK_NAME] };
  return {
    session: withSession(session, { step: "collect_village", draft: { displayName: name } }),
    outbound: [m.ASK_VILLAGE],
  };
}

function handleCollectVillage(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const village = parseVillageChoice(text);
  if (!village) return { session, outbound: [m.INVALID_VILLAGE] };
  return {
    session: withSession(session, { step: "collect_directions", draft: { village } }),
    outbound: [m.ASK_DIRECTIONS],
  };
}

function handleCollectDirections(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const directions = text.trim();
  if (!directions) return { session, outbound: [m.ASK_DIRECTIONS] };
  return {
    session: withSession(session, {
      step: "collect_phone",
      draft: { deliveryDirections: directions },
    }),
    outbound: [m.ASK_PHONE],
  };
}

function handleCollectPhone(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const trimmed = text.trim();
  const phone = trimmed.toUpperCase() === "SKIP" ? session.senderPhone : trimmed;
  if (!phone) return { session, outbound: [m.ASK_PHONE] };
  return {
    session: withSession(session, { step: "collect_persons_affected", draft: { phone } }),
    outbound: [m.ASK_PERSONS_AFFECTED],
  };
}

function handleCollectPersonsAffected(
  session: WhatsAppSession,
  text: string,
): WhatsAppConversationResult {
  const parsed = parsePersonsAffected(text);
  if (!parsed) return { session, outbound: [m.INVALID_PERSONS_AFFECTED] };
  return {
    session: withSession(session, {
      step: "collect_vulnerable",
      draft: { personsAffected: parsed.value },
    }),
    outbound: [m.ASK_VULNERABLE],
  };
}

function handleCollectVulnerable(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const circumstances = parseVulnerableCircumstances(text);
  if (!circumstances) return { session, outbound: [m.INVALID_VULNERABLE] };
  return {
    session: withSession(session, {
      step: "collect_storage",
      draft: { vulnerableCircumstances: circumstances },
    }),
    outbound: [m.ASK_STORAGE],
  };
}

function handleCollectStorage(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const storage = parseAvailableStorage(text);
  return {
    session: withSession(session, {
      step: "collect_urgency",
      draft: { availableStorageCapacity: storage },
    }),
    outbound: [m.ASK_URGENCY],
  };
}

function handleCollectUrgency(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const urgency = parseUrgencyChoice(text);
  if (!urgency) return { session, outbound: [m.INVALID_URGENCY] };

  if (urgency === "critical") {
    return {
      session: withSession(session, {
        step: "collect_critical_explanation",
        draft: { reportedUrgency: urgency },
      }),
      outbound: [m.ASK_CRITICAL_EXPLANATION],
    };
  }

  return {
    session: withSession(session, {
      step: "collect_preferred_driver",
      draft: { reportedUrgency: urgency, criticalExplanation: null },
    }),
    outbound: [m.preferredDriverMenuText(context.eligibleDrivers)],
  };
}

function handleCollectCriticalExplanation(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const explanation = text.trim();
  if (!explanation) return { session, outbound: [m.CRITICAL_EXPLANATION_REQUIRED_MESSAGE] };
  return {
    session: withSession(session, {
      step: "collect_preferred_driver",
      draft: { criticalExplanation: explanation },
    }),
    outbound: [m.preferredDriverMenuText(context.eligibleDrivers)],
  };
}

function handleCollectPreferredDriver(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const choice = parseMenuNumber(text);
  if (choice === null || choice < 0 || choice > context.eligibleDrivers.length) {
    return { session, outbound: [m.INVALID_PREFERRED_DRIVER] };
  }

  const preferredDriverId = choice === 0 ? null : context.eligibleDrivers[choice - 1].uid;
  const nextSession = withSession(session, {
    step: "confirm_request",
    draft: { preferredDriverId },
  });
  return {
    session: nextSession,
    outbound: [m.requestSummaryMessage(nextSession.draft, preferredDriverName(context, preferredDriverId))],
  };
}

function handleConfirmRequestStep(
  session: WhatsAppSession,
  text: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  if (isCancelKeyword(text)) {
    return { session: resetToMenu(session), outbound: [m.REQUEST_CANCELLED_MESSAGE] };
  }

  if (isConfirmKeyword(text)) {
    const draft = session.draft;
    const isRegistered = session.customerType === "registered" && !!session.customerId;
    const actions: WhatsAppConversationResult["actions"] = [];

    if (isRegistered && draft.editingProfile && session.customerId) {
      actions.push({
        type: "update_profile",
        uid: session.customerId,
        displayName: draft.displayName ?? "",
        phone: draft.phone ?? session.senderPhone,
        village: draft.village ?? "",
        deliveryDirections: draft.deliveryDirections ?? "",
      });
    }

    actions.push({
      type: "create_request",
      customerId: isRegistered ? session.customerId : null,
      customer: isRegistered
        ? null
        : {
            displayName: draft.displayName ?? "",
            phone: draft.phone ?? session.senderPhone,
            email: null,
          },
      village: draft.village ?? "",
      deliveryDirections: draft.deliveryDirections ?? "",
      preferredDriverId: draft.preferredDriverId ?? null,
      waterSituation: {
        personsAffected: draft.personsAffected ?? null,
        vulnerableCircumstances: draft.vulnerableCircumstances ?? ["none"],
        availableStorageCapacity: draft.availableStorageCapacity ?? null,
        reportedUrgency: draft.reportedUrgency ?? "normal",
        criticalExplanation: draft.criticalExplanation ?? null,
      },
    });

    return { session: resetToMenu(session), outbound: [], actions };
  }

  return {
    session,
    outbound: [
      m.requestSummaryMessage(session.draft, preferredDriverName(context, session.draft.preferredDriverId ?? null)),
    ],
  };
}

function handleConfirmDelivery(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const choice = parseMenuNumber(text);
  const requestId = session.draft.activeRequestId;

  if (choice === 1 && requestId && session.customerId) {
    return {
      session: resetToMenu(session),
      outbound: [],
      actions: [{ type: "confirm_delivery", requestId, customerId: session.customerId }],
    };
  }

  if (choice === 2) {
    return { session: withSession(session, { step: "collect_dispute_reason" }), outbound: [m.ASK_DISPUTE_REASON] };
  }

  return { session, outbound: [m.INVALID_DELIVERY_CONFIRMATION_CHOICE] };
}

function handleCollectDisputeReason(session: WhatsAppSession, text: string): WhatsAppConversationResult {
  const reason = text.trim();
  if (!reason) return { session, outbound: [m.ASK_DISPUTE_REASON] };

  const requestId = session.draft.activeRequestId;
  if (!requestId || !session.customerId) {
    return { session: resetToMenu(session), outbound: [m.REQUEST_STATE_CHANGED_MESSAGE] };
  }

  return {
    session: resetToMenu(session),
    outbound: [],
    actions: [{ type: "dispute_delivery", requestId, customerId: session.customerId, reason }],
  };
}

export function processMessage(
  session: WhatsAppSession,
  inboundText: string,
  context: WhatsAppConversationContext,
): WhatsAppConversationResult {
  const text = inboundText.trim();

  switch (session.step) {
    case "menu":
      return handleMenu(session, text, context);
    case "confirm_profile":
      return handleConfirmProfile(session, text, context);
    case "collect_name":
      return handleCollectName(session, text);
    case "collect_village":
      return handleCollectVillage(session, text);
    case "collect_directions":
      return handleCollectDirections(session, text);
    case "collect_phone":
      return handleCollectPhone(session, text);
    case "collect_persons_affected":
      return handleCollectPersonsAffected(session, text);
    case "collect_vulnerable":
      return handleCollectVulnerable(session, text);
    case "collect_storage":
      return handleCollectStorage(session, text);
    case "collect_urgency":
      return handleCollectUrgency(session, text, context);
    case "collect_critical_explanation":
      return handleCollectCriticalExplanation(session, text, context);
    case "collect_preferred_driver":
      return handleCollectPreferredDriver(session, text, context);
    case "confirm_request":
      return handleConfirmRequestStep(session, text, context);
    case "confirm_delivery":
      return handleConfirmDelivery(session, text);
    case "collect_dispute_reason":
      return handleCollectDisputeReason(session, text);
    default:
      return { session: resetToMenu(session), outbound: [m.WELCOME_MENU] };
  }
}
