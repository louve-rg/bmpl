import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wishlist',
  description: 'Items you’ve saved to buy later on Belize Marketplace & Logistics.',
};

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
