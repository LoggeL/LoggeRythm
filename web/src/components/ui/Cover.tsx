import CoverPlaceholder from "@/components/CoverPlaceholder";

/**
 * Artwork tile with the branded placeholder as fallback. Size and rounding
 * come from `className` (e.g. "h-12 w-12 rounded-lg").
 */
export default function Cover({
  src,
  alt = "",
  className = "",
  eager = false,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  if (!src) return <CoverPlaceholder className={`shrink-0 ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className={`shrink-0 object-cover ${className}`} />
  );
}
