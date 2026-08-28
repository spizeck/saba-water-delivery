import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { waterOfficeContact } from "@/lib/siteContact";

export const metadata: Metadata = {
  title: "Terms of Use | Saba Water Delivery",
};

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 py-8">
        <Container className="max-w-3xl">
          <Card>
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Terms of Use</h1>
              </div>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Purpose of the service</h2>
                <p className="mt-2 text-slate-600">
                  Saba Water Delivery is a government service that lets residents request a standard government RO water delivery of 1 or 2 1,000-gallon loads and lets authorized drivers claim and complete those deliveries.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Eligibility and authorization</h2>
                <p className="mt-2 text-slate-600">
                  By submitting a request, you confirm that you are authorized to request water at the given location and that the information you provide is true and factual. This matches the attestation presented at the time of request.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Requests and delivery</h2>
                <p className="mt-2 text-slate-600">
                  Requests are for one or two 1,000-gallon loads (1,000 or
                  2,000 gallons total). The service uses reported urgency
                  and vulnerable or critical circumstances to help set an
                  operational dispatch priority. Government staff may
                  reassign or reprioritize requests based on operational
                  need. A preferred driver is a preference, not a guarantee.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Drivers</h2>
                <p className="mt-2 text-slate-600">
                  Drivers are government-authorized and linked through the Driver Registry. A driver must be eligible and available to receive offers. Government staff can restrict or restore driver delivery access.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Confirmation and disputes</h2>
                <p className="mt-2 text-slate-600">
                  Residents are asked to confirm or dispute a delivery after it is marked delivered. Disputed deliveries are flagged for staff review.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Acceptable use</h2>
                <p className="mt-2 text-slate-600">
                  The service must be used honestly and for its intended purpose. Misuse includes submitting false requests, requesting water for locations you are not authorized for, or attempting to disrupt the system.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Service availability</h2>
                <p className="mt-2 text-slate-600">
                  The government aims to run the service reliably, but water delivery depends on driver availability, operational capacity, and circumstances beyond the system&apos;s control. Specific delivery times cannot be guaranteed.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Contact and support</h2>
                <p className="mt-2 text-slate-600">
                  For help, contact the Water Delivery Office. WhatsApp support is available at{" "}
                  {waterOfficeContact.whatsappNumber}.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Changes to these terms</h2>
                <p className="mt-2 text-slate-600">
                  These terms may be updated from time to time. The latest version will always be available on this page.
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
