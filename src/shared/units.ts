export const metersToKm = (meters: number): number => meters / 1000;

export const paceFromDistanceAndTime = (distanceM: number, movingTimeS: number): number | null => {
  if (distanceM <= 0 || movingTimeS <= 0) {
    return null;
  }

  return (movingTimeS * 1000) / distanceM;
};

export const speedToPace = (speedMps: number | null | undefined): number | null => {
  if (!speedMps || speedMps <= 0) {
    return null;
  }

  return 1000 / speedMps;
};
