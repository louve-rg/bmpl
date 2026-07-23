import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { DevMailboxService } from '../notifications/dev-mailbox.service';

/**
 * DEV/TEST-ONLY endpoints. This controller is only registered when
 * NODE_ENV !== 'production' (see DevModule wiring in AppModule), so it can never
 * leak into a production deployment. It exposes the captured outbound emails so
 * a developer or the integration suite can retrieve verification / reset tokens
 * the same way a real user reads their inbox.
 */
@Controller('dev')
export class DevController {
  constructor(private readonly mailbox: DevMailboxService) {}

  @Public()
  @Get('emails/latest')
  latest(@Query('email') email: string) {
    const found = email ? this.mailbox.latestFor(email) : undefined;
    if (!found) throw new NotFoundException('No email captured for that address.');
    return found;
  }
}
