"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const down = /unreachable|fetch failed|ECONNREFUSED/i.test(error.message);
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <p className="eyebrow">{down ? "Service unavailable" : "Error"}</p>
      <h1 className="display mt-4 text-[48px]">{down ? "The API is not responding." : "Something went wrong."}</h1>
      <p className="mt-3 text-mist">{down ? "The Commerce OS API could not be reached. Nothing was charged." : "No transaction was sent. You can try again."}</p>
      <button onClick={reset} className="btn btn-secondary mt-8">Try again</button>
    </div>
  );
}
