import { api } from './api';
import { money } from './cart';

export { money };

export interface OrderItemView {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  subtotalMinor: number;
  currency: string;
  productId: string | null;
  imageUrl: string | null;
}

export interface Address {
  fullName: string;
  phone: string | null;
  /** Null when the customer pinned the location instead of writing it down. */
  addressLine1: string | null;
  addressLine2: string | null;
  city: string;
  district: string;
  country: string;
}

export interface DeliveryEstimate {
  minHours: number;
  maxHours: number;
  label: string | null;
}

export interface DeliveryInfo {
  id?: string;
  status: string;
  feeMinor: number;
  freeApplied: boolean;
  estimate: DeliveryEstimate | null;
  instructions: string | null;
}

export interface VendorOrderView {
  id: string;
  orderNumber: string;
  status: string;
  deliveryMethod: 'PICKUP' | 'DELIVERY';
  customerNotes: string | null;
  currency: string;
  itemCount: number;
  subtotalMinor: number;
  vendor: { businessName: string; slug: string };
  items: OrderItemView[];
  delivery?: DeliveryInfo | null;
  // vendor-detail extras
  parentOrderNumber?: string;
  placedAt?: string;
  customerName?: string;
  deliveryAddress?: Address | null;
  pickedUpAt?: string | null;
}

/** Customer-facing pickup PIN for a single vendor-order (M18.1). */
export interface PickupPinView {
  vendorOrderId: string;
  status: string;
  /** Only present (non-null) while the vendor-order is READY_FOR_PICKUP. */
  pickupPin: string | null;
  pickedUpAt: string | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  itemCount: number;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  placedAt: string;
  deliveryAddress: Address | null;
  vendorOrders: VendorOrderView[];
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  itemCount: number;
  totalMinor: number;
  placedAt: string;
  vendorCount: number;
  vendors: string[];
}

export interface VendorOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  deliveryMethod: 'PICKUP' | 'DELIVERY';
  deliveryFeeMinor: number | null;
  deliveryStatus: string | null;
  itemCount: number;
  subtotalMinor: number;
  currency: string;
  createdAt: string;
  customerName: string;
}

export interface CheckoutBody {
  vendors: Array<{ vendorProfileId: string; deliveryMethod: 'PICKUP' | 'DELIVERY'; customerNotes?: string }>;
  deliveryAddress?: {
    fullName: string;
    phone?: string;
    /** Omitted when the customer pinned the location instead of writing it down. */
    addressLine1?: string;
    addressLine2?: string;
    city: string;
    district: string;
    latitude?: number;
    longitude?: number;
  };
}

export const ordersApi = {
  checkout: (body: CheckoutBody) => api.post<OrderView>('/checkout', body),
  listOwn: () => api.get<OrderListItem[]>('/orders'),
  getOwn: (id: string) => api.get<OrderView>(`/orders/${id}`),
  vendorList: () => api.get<VendorOrderListItem[]>('/vendor/orders'),
  vendorGet: (id: string) => api.get<VendorOrderView>(`/vendor/orders/${id}`),
  // Fulfilment (M26.3) — works for BOTH delivery methods. Marking a DELIVERY
  // order ready is what starts automatic dispatch.
  vendorStartPreparing: (vendorOrderId: string) =>
    api.post<{ id: string; status: string }>(`/vendor/orders/${vendorOrderId}/start-preparing`),
  vendorMarkReady: (vendorOrderId: string) =>
    api.post<{ id: string; status: string }>(`/vendor/orders/${vendorOrderId}/ready`),
  // Pickup fulfilment (M18.1) — PICKUP vendor-orders only.
  vendorReadyForPickup: (vendorOrderId: string) =>
    api.post<{ id: string; status: string }>(`/vendor/orders/${vendorOrderId}/ready-for-pickup`),
  vendorConfirmPickup: (vendorOrderId: string, pin: string) =>
    api.post<{ status: string }>(`/vendor/orders/${vendorOrderId}/confirm-pickup`, { pin }),
  pickupPin: (vendorOrderId: string) =>
    api.get<PickupPinView>(`/orders/vendor-orders/${vendorOrderId}/pickup-pin`),
};

export const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'] as const;
