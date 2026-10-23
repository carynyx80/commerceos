import { ORDER_STATE_LABEL, type OrderState } from "@commerce-os/shared";

const TONE: Record<OrderState, string> = {
  CREATED: "text-dim border-line-2",
  AWAITING_PAYMENT: "text-warn border-warn/40",
  FUNDED: "text-champagne border-champagne/40",
  ACCEPTED: "text-champagne border-champagne/40",
  IN_FULFILLMENT: "text-champagne border-champagne/40",
  FULFILLED: "text-sage border-sage/40",
  RELEASED: "text-ok border-ok/40",
  CANCELLED: "text-dim border-line-2",
  REFUNDED: "text-mist border-line-2",
  DISPUTED: "text-danger border-danger/40",
};

export function OrderStateChip({ state }: { state: OrderState }) {
  return <span className={`chip ${TONE[state]}`}>{ORDER_STATE_LABEL[state]}</span>;
}
