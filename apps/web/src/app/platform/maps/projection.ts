const latitudeLimit = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

export function hasProjectionLimit(positions: readonly { latitude: number }[]): boolean {
  return positions.some((position) => Math.abs(position.latitude) > latitudeLimit);
}
