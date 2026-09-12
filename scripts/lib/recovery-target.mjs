/**
 * Pure target resolution for the disaster-recovery validator (issue #35).
 *
 * Decides, from the environment and argv, WHICH Firestore the validator should
 * read: the local emulator, or a cloud database (via a service-account file or
 * Application Default Credentials). It is a pure function — no Firestore, no
 * process.exit, no I/O — so the safety rules are unit-testable.
 *
 * Safety rule (the important one): if `FIRESTORE_EMULATOR_HOST` is set AND the
 * operator also supplies any explicit CLOUD target (`--database` /
 * `FIREBASE_DATABASE_ID`, `--service-account-file`, or
 * `GOOGLE_APPLICATION_CREDENTIALS`), that is ambiguous — fail with an error
 * rather than silently validating an empty local emulator and reporting a false
 * pass. A pure emulator drill (only emulator config present) is allowed.
 */

/** Reads `--flag=value` or `--flag value` from an argv array. */
export function argValue(argv, flag) {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @returns {{ error: string } | {
 *   mode: "emulator" | "service-account-file" | "adc",
 *   databaseId?: string,
 *   serviceAccountFile?: string,
 *   emulatorHost?: string,
 * }}
 */
export function resolveVerifyTarget(env, argv) {
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST?.trim() || undefined;
  const databaseArg = argValue(argv, "--database")?.trim() || undefined;
  const databaseEnv = env.FIREBASE_DATABASE_ID?.trim() || undefined;
  const serviceAccountFile =
    argValue(argv, "--service-account-file")?.trim() || undefined;
  const adc = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || undefined;

  // Any explicit cloud target signal.
  const cloudSignals = [];
  if (databaseArg) cloudSignals.push("--database");
  if (databaseEnv) cloudSignals.push("FIREBASE_DATABASE_ID");
  if (serviceAccountFile) cloudSignals.push("--service-account-file");
  if (adc) cloudSignals.push("GOOGLE_APPLICATION_CREDENTIALS");

  if (emulatorHost) {
    if (cloudSignals.length > 0) {
      return {
        error:
          `FIRESTORE_EMULATOR_HOST is set (${emulatorHost}) but explicit cloud ` +
          `target configuration was also provided (${cloudSignals.join(", ")}). ` +
          "Refusing to run so a stale emulator variable cannot silently pass a " +
          "cloud validation against an empty local emulator.\n" +
          "Unset FIRESTORE_EMULATOR_HOST to validate a cloud database, or remove " +
          "the cloud options to run a pure emulator drill.",
      };
    }
    return { mode: "emulator", emulatorHost };
  }

  const databaseId = databaseArg ?? databaseEnv ?? undefined;

  if (serviceAccountFile) {
    return { mode: "service-account-file", serviceAccountFile, databaseId };
  }
  if (adc) {
    return { mode: "adc", databaseId };
  }

  return {
    error:
      "No target configured. Set exactly one of:\n" +
      "  - FIRESTORE_EMULATOR_HOST (an emulator drill), or\n" +
      "  - GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json (a key FILE), or\n" +
      "  - --service-account-file=/path/to/key.json\n" +
      "Never inline the service-account JSON on the command line (shell history / process list).",
  };
}
