import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ApiError, serverApi } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";
import { ProductView } from "./product-view";

async function get(id: string) {
  try {
    return await serverApi<ProductDetail>(`/catalog/products/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await get((await params).id).catch(() => null);
  return { title: p?.title ?? "Product" };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await get((await params).id);
  if (!p) notFound();
  return <ProductView p={p} />;
}
