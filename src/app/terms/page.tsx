import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

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
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <strong>Draft for government review.</strong> These terms must be approved before public launch.
                </p>
              </div>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Purpose of the service</h2>
                <p className="mt-2 text-slate-600">
                  Saba Water Delivery is a government service that lets residents request a standard 1,000-gallon government RO water delivery and lets authorized drivers claim and complete those deliveries.
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
                  Requests are for a standard 1,000-gallon delivery. The service uses reported urgency and vulnerable or critical circumstances to help set an operational dispatch priority. Government staff may reassign or reprioritize requests based on operational need. A preferred driver is a preference, not a guarantee.
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
                  For help, contact the Water Delivery Office. WhatsApp support is available at +599 416 5363.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Changes to these terms</h2>
                <p className="mt-2 text-slate-600">
                  These terms will be finalized and may be updated after government review. The approved version will replace this draft before public launch.
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
