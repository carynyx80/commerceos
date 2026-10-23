"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Bell } from "./icons";
import { useSession } from "./session";

export function NotificationBell() {
  const { me } = useSession();
  const q = useQuery({
    queryKey: ["notifications", "unread"],
    enabled: !!me,
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 15_000,
  });
  if (!me) return null;
  const n = q.data?.unread ?? 0;
  return (
    <Link href="/notifications" className="btn btn-ghost btn-sm relative !px-2.5" aria-label={`Notifications, ${n} unread`}>
      <Bell size={17} />
      {n > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-champagne" />}
    </Link>
  );
}
