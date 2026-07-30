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
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  district: string;
  country: string;
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
  // vendor-detail extras
  parentOrderNumber?: string;
  placedAt?: string;
  customerName?: string;
  deliveryAddress?: Address | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  itemCount: number;
  subtotalMinor: number;
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
    addressLine1: string;
    addressLine2?: string;
    city: string;
    district: string;
  };
}

export const ordersApi = {
  checkout: (body: CheckoutBody) => api.post<OrderView>('/checkout', body),
  listOwn: () => api.get<OrderListItem[]>('/orders'),
  getOwn: (id: string) => api.get<OrderView>(`/orders/${id}`),
  vendorList: () => api.get<VendorOrderListItem[]>('/vendor/orders'),
  vendorGet: (id: string) => api.get<VendorOrderView>(`/vendor/orders/${id}`),
};

export const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'] as const;
