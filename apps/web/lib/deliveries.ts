import { api } from './api';
import type { Address, DeliveryEstimate, OrderItemView } from './orders';

/** Driver info surfaced to customers/vendors — display name only, never phone,
 *  legal name, or documents. */
export interface DeliveryDriver {
  displayName: string;
  ratingAverage: number | null;
  completedDeliveries: number | null;
  initials: string;
  /** Approved profile picture — lets the customer check who is at the door. */
  avatarUrl: string | null;
}

export interface DeliveryVehicle {
  type: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  licencePlate: string | null;
}

export interface DeliveryTimelineEvent {
  event: string;
  toStatus: string;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
}

/** GET /deliveries/:id */
export interface CustomerDeliveryDetail {
  id: string;
  status: string;
  statusLabel: string;
  driver: DeliveryDriver | null;
  vehicle: DeliveryVehicle | null;
  estimate: DeliveryEstimate | null;
  timeline: DeliveryTimelineEvent[];
  recipientName: string | null;
  deliveryAddress: Address | null;
  items: OrderItemView[];
  podPhotoUrls: string[];
}

/** GET /deliveries/:id/pin */
export interface DeliveryPin {
  deliveryPin: string;
  verificationStatus: string;
  status: string;
}

/** GET /deliveries/:id/proof and GET /vendor/deliveries/:id/proof */
export interface DeliveryProof {
  recipientName: string | null;
  deliveredAt: string | null;
  podPhotoUrls: string[];
}

/** GET /vendor/deliveries/:id */
export interface VendorDeliveryDetail {
  id?: string;
  status: string;
  statusLabel: string;
  driver: DeliveryDriver | null;
  vehicle: DeliveryVehicle | null;
  timeline: DeliveryTimelineEvent[];
  pickupVerificationStatus: string | null;
  deliveryVerificationStatus: string | null;
  podPhotoUrls: string[];
  deliveryAddress: Address | null;
  items: OrderItemView[];
}

/** GET /vendor/deliveries/:id/pickup-pin */
export interface VendorPickupPin {
  pickupPin: string;
  verificationStatus: string;
  status: string;
}

/** GET /vendor/deliveries?scope=active */
export interface VendorDeliveryListItem {
  id: string;
  status: string;
  statusLabel: string;
  orderNumber: string;
  vendorOrderNumber: string;
  itemCount: number;
  driver: DeliveryDriver | null;
  pickupConfirmed: boolean;
  feeMinor: number;
  createdAt: string;
}

export const deliveriesApi = {
  // customer
  get: (id: string) => api.get<CustomerDeliveryDetail>(`/deliveries/${id}`),
  pin: (id: string) => api.get<DeliveryPin>(`/deliveries/${id}/pin`),
  proof: (id: string) => api.get<DeliveryProof>(`/deliveries/${id}/proof`),
  // vendor
  vendorGet: (id: string) => api.get<VendorDeliveryDetail>(`/vendor/deliveries/${id}`),
  vendorList: (scope: 'active' | 'all' = 'active') =>
    api.get<VendorDeliveryListItem[]>(`/vendor/deliveries?scope=${scope}`),
  vendorPickupPin: (id: string) => api.get<VendorPickupPin>(`/vendor/deliveries/${id}/pickup-pin`),
  vendorProof: (id: string) => api.get<DeliveryProof>(`/vendor/deliveries/${id}/proof`),
};

/** Canonical customer-facing delivery journey. Used to render a resilient
 *  stepper — steps not matching the live status simply stay un-highlighted. */
export const DELIVERY_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'AWAITING_DRIVER', label: 'Awaiting driver' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PICKED_UP', label: 'Picked up' },
  { key: 'ON_THE_WAY', label: 'On the way' },
  { key: 'ARRIVING', label: 'Arriving' },
  { key: 'DELIVERED', label: 'Delivered' },
];

export function isDelivered(status: string): boolean {
  return status === 'DELIVERED';
}
