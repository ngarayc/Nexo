import { HttpException } from '@nestjs/common';

export function accessError(
  code: string,
  status = 403,
  message = 'No fue posible autorizar la solicitud.',
): HttpException {
  return new HttpException({ code, message }, status);
}
