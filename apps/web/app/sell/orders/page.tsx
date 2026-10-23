import { redirect } from "next/navigation";
export default function SellOrders() {
  redirect("/sell?tab=orders");
}
