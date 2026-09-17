# Security Policy

## Supported Versions

Security fixes land on `main` and are released as intentional version
snapshots (see "Release policy" in
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)). The current formal
baseline is
[`v0.9.1`](https://github.com/spizeck/saba-water-delivery/releases/tag/v0.9.1).
Only the latest release line receives security maintenance; older tags
are kept for history, not patched.

| Version | Supported |
| --- | --- |
| `main` / latest release tag | Yes |
| Older release tags | No |

## Reporting a Vulnerability

**Do not open a public issue containing vulnerability details.**

- Preferred: report privately through GitHub → the repository's
  **Security** tab → **Report a vulnerability** (private vulnerability
  reporting). If that option is not enabled on the repository, use the
  next option.
- Alternative: contact the repository owner through the contact channel
  on their GitHub profile, or open an issue that says only that you
  have a security concern to share privately — without technical
  detail — and a maintainer will arrange a private channel.

Include the affected area, reproduction steps or a proof of concept,
the potential impact, and whether it affects the deployed pilot. Never
include real resident data, credentials, or secrets in a report.

This project is maintained by a volunteer pending Public Entity Saba
ownership, so response timelines are best-effort. Accepted
vulnerabilities are fixed on `main`, released under the release policy,
and noted in [`docs/CHANGELOG.md`](./docs/CHANGELOG.md).

## Testing Boundaries

The deployed pilot at `https://saba-water-delivery.vercel.app` serves
real residents and drivers. Security research against it must be
non-destructive:

- No automated scanning that creates, modifies, or deletes data.
- No denial-of-service or sustained load.
- No attempts to access other users' accounts or data.
- No social engineering of staff, drivers, or residents.

Third-party infrastructure (Firebase/GCP, Vercel, Resend, Meta) is
outside this repository's scope — report provider vulnerabilities to
the provider.

## Current Assessment

The current security/readiness assessment is
[`SECURITY_REPORT.md`](./SECURITY_REPORT.md) (baseline `v0.9.1`,
assessed 2026-09-16). The previous dated assessment is preserved as
historical evidence at
[`docs/security/SECURITY_REPORT_2026-09-01.md`](./docs/security/SECURITY_REPORT_2026-09-01.md).
