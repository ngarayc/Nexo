import { Controller, Get } from '@nestjs/common';
import { ApplicationInfoService } from './application-info.service.js';

@Controller()
export class AppController {
  constructor(private readonly applicationInfo: ApplicationInfoService) {}

  @Get()
  describe(): { name: string } {
    return this.applicationInfo.describe();
  }
}
