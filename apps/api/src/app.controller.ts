import { Controller, Get } from '@nestjs/common';
import { ApplicationInfoService } from './application-info.service.js';
import { RequireAccess } from './platform/http/access-policy.js';

@Controller()
export class AppController {
  constructor(private readonly applicationInfo: ApplicationInfoService) {}

  @Get()
  @RequireAccess('public')
  describe(): { name: string } {
    return this.applicationInfo.describe();
  }
}
