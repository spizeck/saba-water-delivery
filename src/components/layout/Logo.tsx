import Image from "next/image";

interface LogoProps {
  /** Accessible label for the logo image. */
  alt?: string;
  /** Additional classes for the wrapper. Use to set the rendered size. */
  className?: string;
}

export function Logo({
  alt = "Public Entity Saba — Saba Water Delivery",
  className = "relative h-10 w-10",
}: LogoProps) {
  return (
    <div className={className}>
      <Image
        src="/PES%20Logo.jpeg"
        alt={alt}
        fill
        className="object-contain"
        priority
        sizes="(max-width: 640px) 40px, 80px"
      />
    </div>
  );
}
