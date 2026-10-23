"use client";
import { useRef, useState } from "react";
import { useToast } from "./toast";

function csrf() {
  return decodeURIComponent(document.cookie.match(/(?:^|; )cos_csrf=([^;]+)/)?.[1] ?? "");
}

/** Uploads one image to Commerce OS media storage and returns its URL. */
export function ImageUpload({ label, onUploaded }: { label: string; onUploaded: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const fd = new FormData();
            fd.append("file", f);
            const res = await fetch("/api/uploads", { method: "POST", body: fd, headers: { "x-csrf-token": csrf() } });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.message ?? "Upload failed");
            onUploaded(body.url);
          } catch (err: any) {
            toast({ title: "Upload failed", body: err.message, tone: "error" });
          } finally {
            setBusy(false);
            if (ref.current) ref.current.value = "";
          }
        }}
      />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}
