import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Privacy Policy | Saba Water Delivery",
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 py-8">
        <Container className="max-w-3xl">
          <Card>
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  Privacy Policy
                </h1>
              </div>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Information we collect
                </h2>
                <p className="mt-2 text-slate-600">
                  To provide water delivery services, the system collects:
                </p>
                <ul className="mt-2 list-inside list-disc text-slate-600">
                  <li>
                    Account and authentication information (email, phone,
                    display name).
                  </li>
                  <li>
                    Delivery location and directions (village and any
                    instructions you provide).
                  </li>
                  <li>
                    Water-request details, including number of people affected,
                    vulnerable or critical circumstances, available storage
                    capacity, and self-reported urgency.
                  </li>
                  <li>
                    Driver and government operational records such as
                    eligibility status, availability, and audit events.
                  </li>
                  <li>
                    Proof-of-delivery or issue photos if the photo feature is
                    enabled in the future.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  How we use information
                </h2>
                <p className="mt-2 text-slate-600">
                  Information is used to process water delivery requests, assign
                  and dispatch drivers, maintain audit records, and support
                  government oversight of the service.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Who can access information
                </h2>
                <p className="mt-2 text-slate-600">
                  Access is limited by role. Residents can see their own
                  requests and profile. Drivers can see the information needed
                  for an assigned delivery. Dispatchers and administrators can
                  see operational records needed to run the service. Viewers can
                  see a read-only oversight view where configured.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Data storage and security
                </h2>
                <p className="mt-2 text-slate-600">
                  The application uses Firebase (Authentication, Firestore, and
                  Storage) and is hosted on Vercel. Technical safeguards include
                  server-side authorization, httpOnly session cookies, and
                  deny-by-default Firestore Security Rules.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Third-party services
                </h2>
                <p className="mt-2 text-slate-600">
                  The service relies on a small number of providers to run:
                </p>
                <ul className="mt-2 list-inside list-disc text-slate-600">
                  <li>
                    <strong className="text-slate-900">
                      Firebase (Google Cloud)
                    </strong>{" "}
                    — sign-in and the database that stores requests, deliveries,
                    and operational records.
                  </li>
                  <li>
                    <strong className="text-slate-900">Vercel</strong> — hosts
                    and runs the application, and keeps short-lived technical
                    hosting logs.
                  </li>
                  <li>
                    <strong className="text-slate-900">Resend</strong> — sends
                    service emails such as account-setup invitations and
                    delivery-confirmation messages, so it processes the
                    recipient&apos;s email address.
                  </li>
                  <li>
                    <strong className="text-slate-900">Sentry</strong> —
                    technical error monitoring, described in the next section.
                  </li>
                </ul>
                <p className="mt-2 text-slate-600">
                  Authentication may be provided through Google or Facebook
                  sign-in if enabled by the government. WhatsApp is currently
                  used only as a support contact number; no WhatsApp integration
                  or data sharing is active at this time.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Error monitoring
                </h2>
                <p className="mt-2 text-slate-600">
                  To keep the service reliable, unexpected application errors
                  are reported automatically to Sentry, a technical error-
                  monitoring service. When an unexpected error occurs, Sentry
                  may receive limited technical diagnostic information — for
                  example the type and message of the error after the
                  application&apos;s own redaction, which part of the
                  application was involved, the browser or device type, a
                  request correlation identifier, and the version of the
                  software that was running.
                </p>
                <p className="mt-2 text-slate-600">
                  The application is configured to exclude personal and
                  sensitive information from these reports — including names,
                  email addresses, phone numbers, delivery addresses and
                  directions, water-request contents, form contents, account
                  identifiers, cookies, sign-in headers and tokens, request
                  bodies, and secrets. Error reports pass through a privacy
                  filter before they leave the application.
                </p>
                <p className="mt-2 text-slate-600">
                  Error monitoring is used only for reliability and fault
                  diagnosis — never for advertising, tracking, behavioral
                  profiling, or product analytics.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Retention
                </h2>
                <p className="mt-2 text-slate-600">
                  Operational records are kept as long as required for service
                  delivery, audit, and oversight purposes. Limited technical
                  diagnostic records — such as error reports and hosting logs —
                  are retained by the providers that hold them according to
                  those providers&apos; configured retention settings.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Your rights and contact
                </h2>
                <p className="mt-2 text-slate-600">
                  For questions, corrections, or concerns about your
                  information, please contact the Water Delivery Office.
                </p>
                <p className="mt-2 text-slate-600">
                  To request deletion of personal data associated with your
                  account, see the{" "}
                  <Link
                    href="/data-deletion"
                    className="font-medium text-blue-700 hover:underline"
                  >
                    Data Deletion
                  </Link>{" "}
                  page.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Updates
                </h2>
                <p className="mt-2 text-slate-600">
                  This policy may be updated from time to time. The latest
                  version will always be available on this page.
                </p>
              </section>
            </div>
          </Card>
        </Container>
      </main>
      <Footer />
    </>
  );
}
