import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PassengerDriverService } from './passenger-driver.service';
import { PassengerProviderService } from './passenger-provider.service';
import { AdminPassengerService } from './admin-passenger.service';
import { PassengerDriverController } from './passenger-driver.controller';
import { PassengerProviderController } from './passenger-provider.controller';
import { AdminPassengerController } from './admin-passenger.controller';

/** Passenger transportation — supply & moderation (S1). Routes, bookings and
 *  trips are later slices; nothing here moves a person or a dollar.
 *  Audit/Notifications come from @Global() modules, as in DriverModule. */
@Module({
  imports: [PrismaModule],
  controllers: [PassengerDriverController, PassengerProviderController, AdminPassengerController],
  providers: [PassengerDriverService, PassengerProviderService, AdminPassengerService],
  exports: [PassengerDriverService, PassengerProviderService],
})
export class PassengerModule {}
