import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PassengerDriverService } from './passenger-driver.service';
import { PassengerProviderService } from './passenger-provider.service';
import { PassengerNetworkService } from './passenger-network.service';
import { AdminPassengerService } from './admin-passenger.service';
import { PassengerDriverController } from './passenger-driver.controller';
import { PassengerProviderController } from './passenger-provider.controller';
import { PassengerNetworkController } from './passenger-network.controller';
import { AdminPassengerController } from './admin-passenger.controller';
import { AdminPassengerNetworkController } from './admin-passenger-network.controller';

/** Passenger transportation — supply & moderation (S1) and the network of
 *  routes and published departures (S2). Bookings and movement are a later
 *  slice; nothing here moves a person or a dollar, and no fare exists.
 *  Audit/Notifications come from @Global() modules, as in DriverModule. */
@Module({
  imports: [PrismaModule],
  controllers: [
    PassengerDriverController,
    PassengerProviderController,
    PassengerNetworkController,
    AdminPassengerController,
    AdminPassengerNetworkController,
  ],
  providers: [PassengerDriverService, PassengerProviderService, PassengerNetworkService, AdminPassengerService],
  exports: [PassengerDriverService, PassengerProviderService],
})
export class PassengerModule {}
