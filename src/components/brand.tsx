import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

const LOGO = { src: "/brand/logo.png", width: 960, height: 681 } as const;
const MARK = { src: "/brand/mark.png", width: 812, height: 480 } as const;

/** GIG monogram. The stacked wordmark does not stay readable at header height. */
export function BrandMark({ className }: { className?: string }) {
  return <Image src={MARK.src} alt="" width={MARK.width} height={MARK.height} className={cn("h-12 w-auto", className)} />;
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Gold Intelligence Gateway home" className={cn("inline-flex items-center", className)}>
      <BrandMark />
    </Link>
  );
}

/** Official stacked lockup for places with room: sidebar, auth, footer, and 404. */
export function BrandLockup({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Gold Intelligence Gateway home" className={cn("mx-auto block w-48", className)}>
      <Image src={LOGO.src} alt="" width={LOGO.width} height={LOGO.height} className="h-auto w-full" />
    </Link>
  );
}
