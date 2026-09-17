const GE0_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const GE0_MAX_POINT_BYTES = 10;
const GE0_MAX_COORD_BITS = GE0_MAX_POINT_BYTES * 3; // 30 bits

export interface OrganicMapsLinkOptions {
  /**
   * Organic Maps zoom level.
   * 19 reproduces your London example.
   */
  zoom?: number;

  /**
   * Optional name appended to the URL.
   */
  name?: string;
}

/**
 * Encode latitude/longitude into Organic Maps' compact GE0 format.
 *
 * Example:
 *   encodeOrganicMaps(51.507445, -0.127766)
 *   => "8tdd0QmXT5"
 */
export function encodeOrganicMaps(
  latitude: number,
  longitude: number,
  options: OrganicMapsLinkOptions = {},
): string {
  const zoom = options.zoom ?? 13;

  if (!Number.isFinite(latitude) || latitude <= -90 || latitude >= 90) {
    throw new RangeError("Latitude must be between -90 and 90");
  }

  if (!Number.isFinite(longitude) || longitude <= -180 || longitude >= 180) {
    throw new RangeError("Longitude must be between -180 and 180");
  }

  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 20) {
    throw new RangeError("Zoom must be an integer between 1 and 20");
  }

  /*
   * The first character stores the zoom.
   *
   * Organic Maps decodes this as:
   *
   *   zoom = round(value / 4 + 4)
   *
   * Therefore the inverse is:
   *
   *   value = round((zoom - 4) * 4)
   */
  const zoomValue = Math.round((zoom - 4) * 4);
  const zoomChar = GE0_ALPHABET[zoomValue];

  /*
   * Convert coordinates to unsigned 30-bit integers.
   *
   * Latitude:
   *   -90 ... +90  ->  0 ... 2^30 - 1
   *
   * Longitude:
   *   -180 ... +180 -> 0 ... 2^30 - 1
   *
   * This matches Organic Maps' decoder.
   */
  const latValue = Math.round(
    ((latitude + 90) / 180) * ((1 << GE0_MAX_COORD_BITS) - 1),
  );

  const lonValue = Math.round(
    ((longitude + 180) / 360) * (1 << GE0_MAX_COORD_BITS),
  );

  /*
   * At zoom 19 Organic Maps uses 9 coordinate characters.
   *
   * The GE0 format stores 3 bits of latitude and 3 bits of
   * longitude in each character, interleaved:
   *
   *       latitude:  L2 L1 L0
   *      longitude:  G2 G1 G0
   *
   * producing:
   *
   *       L2 G2 L1 G1 L0 G0
   *
   * The current Organic Maps decoder performs the reverse
   * operation.
   */
  const coordinateChars = 9;

  let coordinates = "";

  for (let i = 0; i < coordinateChars; i++) {
    const shift = GE0_MAX_COORD_BITS - 3 * (i + 1);

    let value = 0;

    for (let j = 0; j < 3; j++) {
      // Take the latitude bits from most-significant to least-significant.
      const latBit = (latValue >> (shift + 2 - j)) & 1;

      // Take the longitude bits from most-significant to least-significant.
      const lonBit = (lonValue >> (shift + 2 - j)) & 1;

      // Interleave them:
      //
      // bit 5 = latitude bit 2
      // bit 4 = longitude bit 2
      // bit 3 = latitude bit 1
      // bit 2 = longitude bit 1
      // bit 1 = latitude bit 0
      // bit 0 = longitude bit 0
      value |= latBit << (5 - 2 * j);
      value |= lonBit << (4 - 2 * j);
    }

    coordinates += GE0_ALPHABET[value];
  }

  return zoomChar + coordinates;
}

/**
 * Create a complete Organic Maps share URL.
 */
export function organicMapsUrl(
  latitude: number,
  longitude: number,
  options: OrganicMapsLinkOptions = {},
): string {
  const encoded = encodeOrganicMaps(latitude, longitude, options);

  if (options.name) {
    return `https://omaps.app/${encoded}/${encodeURIComponent(options.name.replaceAll(" ", "_"))}`;
  }

  return `https://omaps.app/${encoded}`;
}
