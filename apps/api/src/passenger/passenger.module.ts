import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PassengerDriverService } from './passenger-driver.service';
import { PassengerProviderService } from './passenger-provider.service';
import { PassengerNetworkService } from './passenger-network.service';
import { PassengerOperationsService } from './passenger-operations.service';
import { PassengerAffiliationService } from './passenger-affiliation.service';
import { AdminPassengerService } from './admin-passenger.service';
import { PassengerDriverController } from './passenger-driver.controller';
import { PassengerDriverTripsController } from './passenger-driver-trips.controller';
import { PassengerDriverAffiliationsController } from './passenger-driver-affiliations.controller';
import { PassengerProviderController } from './passenger-provider.controller';
import { PassengerNetworkController } from './passenger-network.controller';
import { PassengerRiderController } from './passenger-rider.controller';
import { AdminPassengerController } from './admin-passenger.controller';
import { AdminPassengerNetworkController } from './admin-passenger-network.controller';

/** Passenger transportation — supply & moderation (S1), the network of routes
 *  and published departures (S2), and booking & movement behind the fare gate
 *  (S3). People move; money still does not — no fare is computed, quoted or
 *  charged anywhere, and the gate refuses bookings until an operator
 *  configures one. Audit/Notifications come from @Global() modules. */
@Module({
  imports: [PrismaModule],
  controllers: [
    PassengerDriverController,
    PassengerDriverTripsController,
    PassengerDriverAffiliationsController,
    PassengerProviderController,
    PassengerNetworkController,
    PassengerRiderController,
    AdminPassengerController,
    AdminPassengerNetworkController,
  ],
  providers: [
    PassengerDriverService,
    PassengerProviderService,
    PassengerNetworkService,
    PassengerOperationsService,
    PassengerAffiliationService,
    AdminPassengerService,
  ],
  exports: [PassengerDriverService, PassengerProviderService],
})
export class PassengerModule {}
