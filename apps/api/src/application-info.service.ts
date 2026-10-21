import { Injectable } from '@nestjs/common';

@Injectable()
export class ApplicationInfoService {
  describe(): { name: string } {
    return { name: 'Nexo' };
  }
}
