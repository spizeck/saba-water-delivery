/**
 * Pure target resolution for the READ-ONLY production integrity diagnostic
 * (issue #52), `scripts/production-integrity.mjs`.
 *
 * It builds on the disaster-recovery resolver (`resolveVerifyTarget` in
 * recovery-target.mjs) — reusing its most important safety rule (a stale
 * `FIRESTORE_EMULATOR_HOST` alongside explicit cloud config is rejected, so a
 * cloud run can never silently pass against an empty local emulator) — and adds
 * the stricter rules a ROUTINE production diagnostic needs, distinct from a
 * deliberate disaster-recovery drill:
 *
 *   - Scanning a CLOUD target requires an explicit `--production` acknowledgement
 *     (a deliberate "yes, this is live data"). The emulator never needs it.
 *   - A cloud target must resolve to a NON-AMBIGUOUS project id. `--production`
 *     with an emulator-resolved target is rejected (cloud must not fall back to
 *     the emulator), and vice versa an emulator run rejects `--production`.
 *   - Application Default Credentials mode must be given an explicit project
 *     (`--project` / GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT /
 *     FIREBASE_ADMIN_PROJECT_ID); it must not fall back to ADC's implicit
 *     default project. Service-account-file mode may instead derive the project
 *     from the key file (the CLI reads `project_id` from the file — see
 *     `projectId: null` below).
 *   - Credentials are NEVER read from an inline command-line JSON value; an
 *     accidental `--service-account=<json>` is rejected with guidance to use
 *     `--service-account-file=/path`.
 *
 * Pure function: no Firestore, no process.exit, no file I/O — every rule is
 * unit-testable. The CLI performs the file read (for a key file's project_id)
 * and the printing/exit.
 */

import { argValue, resolveVerifyTarget } from "./recovery-target.mjs";

/** True when the flag is present in argv (with or without a value). */
function hasFlag(argv, flag) {
  return argv.some((a) => a === flag || a.startsWith(`${flag}=`));
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @returns {{ error: string } | {
 *   mode: "emulator" | "service-account-file" | "adc",
 *   production: boolean,
 *   projectId: string | null,
 *   databaseId: string | null,
 *   serviceAccountFile?: string,
 *   emulatorHost?: string,
 * }}
 */
export function resolveIntegrityTarget(env, argv) {
  // Never accept inline service-account JSON on the command line.
  if (hasFlag(argv, "--service-account")) {
    return {
      error:
        "Refusing to accept inline service-account JSON (--service-account). " +
        "It would land in shell history and the process list. Use " +
        "--service-account-file=/path/to/key.json instead.",
    };
  }

  const production = hasFlag(argv, "--production");

  // Base emulator-vs-cloud decision + the stale-emulator/cloud ambiguity guard.
  const base = resolveVerifyTarget(env, argv);
  if ("error" in base) return base;

  const explicitProject =
    argValue(argv, "--project")?.trim() ||
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GCLOUD_PROJECT?.trim() ||
    env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    undefined;
  const databaseId = base.databaseId ?? null;

  if (base.mode === "emulator") {
    if (production) {
      return {
        error:
          `--production was given but the target resolves to the Firestore ` +
          `EMULATOR (${base.emulatorHost}). Refusing to run: a production ` +
          `diagnostic must not silently scan the emulator. Unset ` +
          `FIRESTORE_EMULATOR_HOST to scan a cloud project, or drop ` +
          `--production for an emulator run.`,
      };
    }
    return {
      mode: "emulator",
      production: false,
      projectId: explicitProject ?? null,
      databaseId,
      emulatorHost: base.emulatorHost,
    };
  }

  // Cloud target (adc | service-account-file).
  if (!production) {
    return {
      error:
        "Refusing to scan a CLOUD Firestore target without an explicit " +
        "--production acknowledgement. Re-run with --production once you have " +
        "confirmed the printed project/database is the intended live target.",
    };
  }

  if (base.mode === "adc" && !explicitProject) {
    return {
      error:
        "Application Default Credentials mode requires an explicit project so " +
        "the diagnostic cannot use ADC's implicit default project. Pass " +
        "--project=<id> (or set GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / " +
        "FIREBASE_ADMIN_PROJECT_ID).",
    };
  }

  return {
    mode: base.mode,
    production: true,
    // For a service-account file, the project may be derived from the key file
    // by the CLI when not given explicitly (projectId: null signals that).
    projectId: explicitProject ?? null,
    databaseId,
    serviceAccountFile: base.serviceAccountFile,
  };
}
