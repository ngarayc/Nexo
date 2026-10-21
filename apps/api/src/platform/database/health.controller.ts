import { Controller, Get, ServiceUnavailableException, Header } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getHealth() {
    if (!(await this.database.isHealthy())) {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok', database: 'ok', schema: 'ok' };
  }
}
