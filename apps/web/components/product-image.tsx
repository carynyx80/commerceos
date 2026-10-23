import Image from "next/image";

/** Product photo with a quiet fallback when a listing has no image. */
export function ProductImage({ src, alt, sizes, priority, className = "" }: { src?: string; alt: string; sizes: string; priority?: boolean; className?: string }) {
  if (!src)
    return (
      <div className={`absolute inset-0 grid place-items-center bg-gradient-to-br from-evergreen/60 to-obsidian-3 ${className}`}>
        <span className="display text-[28px] text-porcelain/30">{alt.slice(0, 1)}</span>
      </div>
    );
  return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={`object-cover ${className}`} />;
}
