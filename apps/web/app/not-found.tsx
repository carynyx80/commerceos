import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <p className="eyebrow">404</p>
      <h1 className="display mt-4 text-[56px]">Not here.</h1>
      <p className="mt-3 text-mist">That page, product or store doesn’t exist, or was removed.</p>
      <Link href="/explore" className="btn btn-secondary mt-8">Back to the marketplace</Link>
    </div>
  );
}
