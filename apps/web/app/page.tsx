import { Header } from '../components/landing/Header';
import { Hero } from '../components/landing/Hero';
import { Services } from '../components/landing/Services';
import { WhyChooseUs } from '../components/landing/WhyChooseUs';
import { WalletSection } from '../components/landing/Wallet';
import { Providers } from '../components/landing/Providers';
import { MobilePromo } from '../components/landing/MobilePromo';
import { FinalCTA } from '../components/landing/FinalCTA';
import { Footer } from '../components/landing/Footer';
import { DiscoverySections } from '../components/discovery/DiscoverySections';
import { CrossModuleDiscovery } from '../components/discovery/CrossModuleDiscovery';
import { PromotedSections } from '../components/marketing/PromotedSections';
import { ForYou } from '../components/discovery/ForYou';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Services />
        <PromotedSections />
        <DiscoverySections />
        <CrossModuleDiscovery />
        <ForYou className="container-bmpl py-4 pb-16" />
        <WhyChooseUs />
        <Providers />
        <WalletSection />
        <MobilePromo />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
