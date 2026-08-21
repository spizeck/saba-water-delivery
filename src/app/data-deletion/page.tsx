import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { waterOfficeContact } from "@/lib/siteContact";

export const metadata: Metadata = {
  title: "User Data Deletion | Saba Water Delivery",
  description:
    "Instructions for requesting deletion of personal data associated with the Saba Water Delivery service.",
};

export default function DataDeletionPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 py-8">
        <Container className="max-w-3xl">
          <Card>
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">User Data Deletion</h1>
                <p className="mt-2 text-slate-600">
                  Saba Water Delivery is the official government water delivery
                  service for Saba. This page explains how to request deletion
                  of personal data associated with your Saba Water Delivery
                  account.
                </p>
              </div>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  Request deletion of your data
                </h2>
                <p className="mt-2 text-slate-600">
                  If you would like to request deletion of personal data
                  associated with your Saba Water Delivery account, please
                  contact the Water Delivery Office via WhatsApp at{" "}
                  <a
                    href={waterOfficeContact.whatsappHref}
                    className="font-medium text-blue-700 hover:underline"
                    aria-label={`Contact the Water Delivery Office via WhatsApp at ${waterOfficeContact.whatsappNumber} to request data deletion`}
                  >
                    {waterOfficeContact.whatsappNumber}
                  </a>
                  .
                </p>
                <p className="mt-2 text-slate-600">
                  Please include enough information for the Water Delivery
                  Office to identify and verify the account associated with
                  your request — for example, your name, phone number, and the
                  village or delivery address on file.
                </p>
                <p className="mt-2 font-medium text-slate-700">
                  Do not send your password, Facebook access token, or any
                  other authentication credentials. The Water Delivery Office
                  will never ask you for these, and they are never needed to
                  process a data deletion request.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  What happens after you request deletion
                </h2>
                <p className="mt-2 text-slate-600">
                  After your identity and request are verified, personal data
                  associated with your account will be deleted or anonymized
                  where appropriate, subject to any legal, regulatory,
                  operational, or government record-retention requirements
                  that apply. As a government operational service, some
                  request, delivery, audit, or government records may need to
                  be retained even after a deletion request is processed.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">Facebook Login</h2>
                <p className="mt-2 text-slate-600">
                  If you signed in to Saba Water Delivery using Facebook Login,
                  you can also remove Saba Water Delivery&apos;s access to your
                  Facebook account at any time from Facebook&apos;s Settings
                  (Settings &amp; Privacy → Settings → Apps and Websites).
                </p>
                <p className="mt-2 text-slate-600">
                  <strong className="text-slate-900">
                    Removing Facebook authorization
                  </strong>{" "}
                  only stops Saba Water Delivery from being able to use
                  Facebook to sign you in. It does not, by itself, delete or
                  change any water-request, delivery, or account records
                  already held by Saba Water Delivery.
                </p>
                <p className="mt-2 text-slate-600">
                  <strong className="text-slate-900">
                    Requesting deletion of Saba Water Delivery data
                  </strong>{" "}
                  is a separate step — contact the Water Delivery Office as
                  described above.
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
