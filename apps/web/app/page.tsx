import { Header } from '../components/landing/Header';
import { Hero } from '../components/landing/Hero';
import { Services } from '../components/landing/Services';
import { WhyChooseUs } from '../components/landing/WhyChooseUs';
import { WalletSection } from '../components/landing/Wallet';
import { Providers } from '../components/landing/Providers';
import { MobilePromo } from '../components/landing/MobilePromo';
import { FinalCTA } from '../components/landing/FinalCTA';
import { Footer } from '../components/landing/Footer';

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Services />
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
