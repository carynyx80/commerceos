"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Heart } from "./icons";
import { useSession } from "./session";
import { useToast } from "./toast";

export function useSaved() {
  const { me } = useSession();
  return useQuery({ queryKey: ["saved-ids", me?.id], enabled: !!me, queryFn: () => api<{ ids: string[] }>("/saved/ids") });
}

export function SaveButton({ productId }: { productId: string }) {
  const { me } = useSession();
  const saved = useSaved();
  const qc = useQueryClient();
  const toast = useToast();
  const on = saved.data?.ids.includes(productId) ?? false;
  return (
    <button
      aria-label={on ? "Remove from saved" : "Save product"}
      aria-pressed={on}
      onClick={async () => {
        if (!me) return toast({ title: "Sign in to save products", body: "Connect your wallet and sign in from the top bar." });
        try {
          await api(`/saved/${productId}`, { method: on ? "DELETE" : "PUT" });
          await qc.invalidateQueries({ queryKey: ["saved-ids"] });
        } catch (e: any) {
          toast({ title: "Could not update saved items", body: e.message, tone: "error" });
        }
      }}
      className={`grid size-8 place-items-center rounded-full bg-obsidian/60 backdrop-blur transition-colors ${on ? "text-champagne" : "text-porcelain/80 hover:text-porcelain"}`}
    >
      <Heart size={15} filled={on} />
    </button>
  );
}
