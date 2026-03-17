"use client";

export type OrderCheckoutItem = {
  sku: string;
  title: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
};

export type OrderCheckoutContext = {
  source: "package" | "negotiation" | "plaza";
  packageId?: string;
  packageTitle: string;
  summary?: string;
  items: OrderCheckoutItem[];
  subtotal: number;
  negotiatedSavings?: number;
};

export type OrderFormData = {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  province: string;
  city: string;
  district: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  deliveryNote: string;
};

export type OrderRecord = {
  orderId: string;
  createdAt: string;
  packageTitle: string;
  totalAmount: number;
  savings: number;
  status: "confirmed";
};

type OrderStoreState = {
  checkout: OrderCheckoutContext | null;
  form: OrderFormData;
  currentOrder: OrderRecord | null;
};

const ORDER_STORAGE_KEY = "nexbuy.order.state";

const DEFAULT_FORM: OrderFormData = {
  fullName: "",
  email: "",
  phone: "",
  country: "",
  province: "",
  city: "",
  district: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  deliveryNote: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeStore(raw: unknown): OrderStoreState {
  if (!isRecord(raw)) {
    return { checkout: null, form: { ...DEFAULT_FORM }, currentOrder: null };
  }

  return {
    checkout: isRecord(raw.checkout) ? (raw.checkout as OrderCheckoutContext) : null,
    form: isRecord(raw.form) ? { ...DEFAULT_FORM, ...(raw.form as Partial<OrderFormData>) } : { ...DEFAULT_FORM },
    currentOrder: isRecord(raw.currentOrder) ? (raw.currentOrder as OrderRecord) : null,
  };
}

export function readOrderState(): OrderStoreState {
  if (typeof window === "undefined") {
    return { checkout: null, form: { ...DEFAULT_FORM }, currentOrder: null };
  }

  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    return normalizeStore(raw ? JSON.parse(raw) : null);
  } catch {
    return { checkout: null, form: { ...DEFAULT_FORM }, currentOrder: null };
  }
}

function writeOrderState(nextState: Partial<OrderStoreState>) {
  if (typeof window === "undefined") {
    return;
  }

  const current = readOrderState();
  window.localStorage.setItem(
    ORDER_STORAGE_KEY,
    JSON.stringify({
      ...current,
      ...nextState,
      form: nextState.form ? { ...DEFAULT_FORM, ...nextState.form } : current.form,
    }),
  );
}

export function setOrderCheckout(checkout: OrderCheckoutContext) {
  writeOrderState({ checkout, currentOrder: null });
}

export function setOrderForm(form: Partial<OrderFormData>) {
  writeOrderState({
    form: {
      ...readOrderState().form,
      ...form,
    },
  });
}

export function setCurrentOrder(order: OrderRecord) {
  writeOrderState({ currentOrder: order });
}

export function clearCurrentOrder() {
  writeOrderState({ currentOrder: null });
}

export function clearOrderCheckout() {
  writeOrderState({ checkout: null, currentOrder: null });
}

export function clearOrderState() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ORDER_STORAGE_KEY);
}

export function getDefaultOrderForm() {
  return { ...DEFAULT_FORM };
}
