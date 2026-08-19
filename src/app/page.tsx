import { SiteHeader } from "@/components/layout/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export default function Home() {
  const whatsappNumber = "+599 416 5363";
  const whatsappHref = "https://wa.me/5994165363";

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-2xl">
          <div className="flex flex-col items-start gap-6">
            <div>
              <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
                Saba Water Delivery
              </h1>
              <p className="mt-2 max-w-xl text-lg text-slate-600">
                Request government RO water delivery quickly and fairly.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <LinkButton
                href="/login?portal=resident"
                size="lg"
                className="w-full justify-center sm:flex-1"
                aria-label="Log in to request water delivery"
              >
                Login to Request Water
              </LinkButton>
              <LinkButton
                href="/login?portal=driver"
                size="lg"
                variant="outline"
                className="w-full justify-center sm:flex-1"
                aria-label="Log in to the driver portal"
              >
                Driver Login
              </LinkButton>
            </div>

            <section
              className="w-full border-t border-slate-200 pt-6"
              aria-labelledby="help-heading"
            >
              <h2 id="help-heading" className="text-base font-semibold text-slate-900">
                Need Help?
              </h2>
              <p className="mt-2 text-slate-600">
                If you are having difficulty with ordering water from this page, please{" "}
                <a
                  href={whatsappHref}
                  className="font-medium text-blue-700 hover:underline"
                  aria-label={`Contact the Water Delivery Office via WhatsApp at ${whatsappNumber}`}
                >
                  call via WhatsApp {whatsappNumber}
                </a>
              </p>
            </section>
          </div>
        </Container>
      </main>
    </>
  );
}
