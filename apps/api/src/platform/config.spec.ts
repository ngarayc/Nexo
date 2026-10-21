import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config.js';

describe('configuración de escucha', () => {
  it('limita el arranque local a loopback por defecto', () => {
    expect(readServerConfig({})).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it.each(['', '0', '65536', '-1', '3000.5', ' 3000', '3000x'])('rechaza PORT=%j', (port) => {
    expect(() => readServerConfig({ PORT: port })).toThrow('PORT');
  });

  it('admite el límite de puerto y una interfaz de contenedor explícita', () => {
    expect(readServerConfig({ HOST: '0.0.0.0', PORT: '65535' })).toEqual({
      host: '0.0.0.0',
      port: 65535,
    });
  });

  it('rechaza una dirección arbitraria sin reflejar su contenido', () => {
    expect(() => readServerConfig({ HOST: 'valor-no-admitido' })).toThrow(
      'HOST debe ser una dirección de escucha admitida.',
    );
  });
});
