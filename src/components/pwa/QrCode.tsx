import { toString } from "qrcode";

interface QrCodeProps {
  value: string;
  label: string;
  alt: string;
  size?: number;
}

/**
 * Server-rendered, deterministic QR code. The SVG output is always the same
 * for the same input URL, so printed codes stay valid as long as the
 * production URL does not change.
 */
export async function QrCode({ value, label, alt, size = 256 }: QrCodeProps) {
  const svg = await toString(value, {
    type: "svg",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="rounded-xl border border-slate-200 bg-white p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
        aria-label={alt}
        role="img"
      />
      <p className="max-w-[16rem] break-all text-center text-xs font-mono text-slate-500">{value}</p>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
    </div>
  );
}
