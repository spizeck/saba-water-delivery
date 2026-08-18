import { SiteHeader } from "@/components/layout/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container>
          <div className="flex flex-col items-start gap-6">
            <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
              Request government RO water delivery
            </h1>
            <p className="max-w-xl text-lg text-slate-600">
              Saba&apos;s water delivery system connects residents directly with
              authorized government water drivers &mdash; no need to call a
              driver you know.
            </p>
            <LinkButton href="/login" size="lg">
              Log in to request water
            </LinkButton>

            <dl className="mt-6 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <dt className="text-sm font-medium text-slate-500">Residents</dt>
                <dd className="mt-1 text-sm text-slate-700">
                  Request a standard 1,000-gallon load, ASAP.
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <dt className="text-sm font-medium text-slate-500">Drivers</dt>
                <dd className="mt-1 text-sm text-slate-700">
                  Go online and claim available deliveries.
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <dt className="text-sm font-medium text-slate-500">Government</dt>
                <dd className="mt-1 text-sm text-slate-700">
                  Full visibility into every request and delivery.
                </dd>
              </div>
            </dl>
          </div>
        </Container>
      </main>
    </>
  );
}
