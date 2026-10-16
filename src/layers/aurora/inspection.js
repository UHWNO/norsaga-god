/** Index the published one-degree values, including zero; missing cells stay missing. */
export function createAuroraGrid(cells) {
  const values = new Int16Array(360 * 181).fill(-1);
  for (const [lon, lat, value] of cells)
    values[(lon + 180) * 181 + lat + 90] = value;
  return {
    sample(longitude, latitude) {
      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(latitude) > 90
      )
        return null;
      const lon = ((((Math.round(longitude) + 180) % 360) + 360) % 360) - 180;
      const lat = Math.round(latitude);
      const value = values[(lon + 180) * 181 + lat + 90];
      return value < 0 ? null : { longitude: lon, latitude: lat, value };
    },
  };
}

/** Explicit map-center inspection; no pointer listeners or selection ownership. */
export function inspectAuroraAtCenter(grid, viewer, C) {
  const canvas = viewer?.scene?.canvas;
  const ellipsoid = viewer?.scene?.globe?.ellipsoid || C.Ellipsoid?.WGS84;
  const position =
    canvas &&
    viewer.camera?.pickEllipsoid?.(
      new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      ellipsoid,
    );
  if (!position || !grid)
    return {
      value: null,
      coordinates: 'Aim the center of the map at Earth',
      cell: null,
    };
  const point = C.Cartographic.fromCartesian(position, ellipsoid);
  const longitude = C.Math.toDegrees(point.longitude),
    latitude = C.Math.toDegrees(point.latitude);
  const cell = grid.sample(longitude, latitude);
  return {
    value: cell?.value ?? null,
    coordinates: `${Math.abs(latitude).toFixed(2)}°${latitude < 0 ? 'S' : 'N'} · ${Math.abs(longitude).toFixed(2)}°${longitude < 0 ? 'W' : 'E'}`,
    cell,
  };
}
