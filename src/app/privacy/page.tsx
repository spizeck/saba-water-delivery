import type { Metadata } from "next";

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
                <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <strong>Draft for government review.</strong> This policy must be approved before public launch.
                </p>
              </div>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Information we collect</h2>
                <p className="mt-2 text-slate-600">
                  To provide water delivery services, the system collects:
                </p>
                <ul className="mt-2 list-inside list-disc text-slate-600">
                  <li>Account and authentication information (email, phone, display name).</li>
                  <li>Delivery location and directions (village and any instructions you provide).</li>
                  <li>Water-request details, including number of people affected, vulnerable or critical circumstances, available storage capacity, and self-reported urgency.</li>
                  <li>Driver and government operational records such as eligibility status, availability, and audit events.</li>
                  <li>Proof-of-delivery or issue photos if the photo feature is enabled in the future.</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">How we use information</h2>
                <p className="mt-2 text-slate-600">
                  Information is used to process water delivery requests, assign and dispatch drivers, maintain audit records, and support government oversight of the service.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Who can access information</h2>
                <p className="mt-2 text-slate-600">
                  Access is limited by role. Residents can see their own requests and profile. Drivers can see the information needed for an assigned delivery. Dispatchers and administrators can see operational records needed to run the service. Viewers can see a read-only oversight view where configured.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Data storage and security</h2>
                <p className="mt-2 text-slate-600">
                  The application uses Firebase (Authentication, Firestore, and Storage) and is hosted on Vercel. Technical safeguards include server-side authorization, httpOnly session cookies, and deny-by-default Firestore Security Rules. The government is reviewing the final security and data-processing arrangements.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Third-party services</h2>
                <p className="mt-2 text-slate-600">
                  Authentication may be provided through Google or Facebook sign-in if enabled by the government. WhatsApp is currently used only as a support contact number; no WhatsApp integration or data sharing is active at this time.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Retention</h2>
                <p className="mt-2 text-slate-600">
                  Retention periods are under government review. Operational records are kept as long as required for service delivery, audit, and oversight purposes.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Your rights and contact</h2>
                <p className="mt-2 text-slate-600">
                  For questions, corrections, or concerns about your information, please contact the Water Delivery Office. A formal contact and review process is being finalized by the government.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Updates</h2>
                <p className="mt-2 text-slate-600">
                  This policy will be updated as the service approaches launch and as government sign-off is completed. The final, approved version will replace this draft.
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
