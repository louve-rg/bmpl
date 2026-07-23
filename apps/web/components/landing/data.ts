/** Service catalog shown on the landing page. Copy echoes the existing brand
 *  voice; these are descriptive service claims, not invented statistics. */
export interface ServiceCard {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string; // emoji glyph — swap for brand icons when supplied
  href: string;
  status: 'live' | 'coming-soon';
}

export const SERVICES: ServiceCard[] = [
  {
    id: 'marketplace',
    name: 'Marketplace',
    tagline: 'Browse & buy',
    description:
      'Shop from Belizean vendors across every district. Discover products and support local businesses.',
    icon: '🛍️',
    href: '/services/marketplace',
    status: 'coming-soon',
  },
  {
    id: 'shipping',
    name: 'Shipping & Delivery',
    tagline: 'Land, air & sea',
    description:
      'Comprehensive delivery connecting every district with fast, dependable nationwide coverage.',
    icon: '🚚',
    href: '/services/shipping',
    status: 'coming-soon',
  },
  {
    id: 'passenger',
    name: 'Passenger Service',
    tagline: 'Travel with confidence',
    description:
      'Secure, comfortable travel for individuals and groups — built on safety, punctuality, and satisfaction.',
    icon: '🚗',
    href: '/services/passenger',
    status: 'coming-soon',
  },
  {
    id: 'connect',
    name: 'Belize Connect',
    tagline: 'Jobs & talent',
    description:
      "Bridging talent with opportunity — explore careers, connect with employers, and fuel Belize's workforce.",
    icon: '💼',
    href: '/services/connect',
    status: 'coming-soon',
  },
  {
    id: 'realestate',
    name: 'Real Estate',
    tagline: 'Homes & land',
    description:
      'Find homes and land across Belize — detailed listings, map views, and trusted agents ready to guide you.',
    icon: '🏝️',
    href: '/services/real-estate',
    status: 'coming-soon',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    tagline: 'Grow your reach',
    description:
      'Boost visibility for your business, products, or events — get seen by more customers and grow.',
    icon: '📣',
    href: '/services/marketing',
    status: 'coming-soon',
  },
];

export const TRUST_POINTS = [
  {
    title: 'Secure & Reliable',
    body: 'Bank-grade security, revocable sessions, and audited administrative actions on every account.',
    icon: '🔒',
  },
  {
    title: 'Nationwide Coverage',
    body: 'From Corozal to Toledo — one platform connecting all six districts of Belize.',
    icon: '🗺️',
  },
  {
    title: 'Real-time Updates',
    body: 'Stay informed with timely notifications across your orders, roles, and services.',
    icon: '⚡',
  },
];
