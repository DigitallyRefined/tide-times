export interface TcdHeader {
  version: string;
  majorRev: number;
  minorRev: number;
  lastModified: string;
  headerSize: number;
  numberOfRecords: number;
  startYear: number;
  numberOfYears: number;
  endOfFile: number;
  constituents: string[];
  tzfiles: string[];
  levelUnits: string[];
  dirUnits: string[];
  restrictions: string[];
  countries: string[];
  datums: string[];
  legaleses: string[];
  fields: Record<string, number>;
  crcStored: number;
  crcComputed: number;
  crcValid: boolean;
  recordsStartByte: number;
}

export interface RecordMeta {
  index: number;
  type: 1 | 2;
  recordSize: number;
  recordStartBit: number;
  latitude: number;
  longitude: number;
  timezoneIndex: number;
  name: string;
  referenceStation: number;
}

export interface TideConstituent {
  name: string;
  amplitude: number;
  phase: number;
}

export interface ReferenceStation {
  index: number;
  type: 1;
  name: string;
  country: string;
  timezone: string;
  latitude: number;
  longitude: number;
  id: string;
  stationIdContext: string;
  stationId: string;
  source: string;
  datum: string;
  datumOffset: number;
  levelUnit: string;
  monthsOnStation: number;
  confidence: number;
  constituents: TideConstituent[];
}

export class TcdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TcdError";
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array, start: number, length: number): number {
  let c = 0xffffffff;
  for (let i = start; i < start + length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

class BitReader {
  pos: number;

  private bytes: Uint8Array;

  constructor(bytes: Uint8Array, startBit = 0) {
    this.bytes = bytes;
    this.pos = startBit;
  }

  read(n: number): number {
    let acc = 0;
    let bits = n;
    while (bits > 0) {
      const byte = this.bytes[this.pos >> 3];
      const skip = this.pos & 7;
      const avail = 8 - skip;
      const take = Math.min(avail, bits);
      const shift = avail - take;
      const chunk = (byte >> shift) & ((1 << take) - 1);
      acc = acc * Math.pow(2, take) + chunk;
      this.pos += take;
      bits -= take;
    }
    return acc;
  }

  readSigned(n: number): number {
    const v = this.read(n);
    if (v & (1 << (n - 1))) return v - Math.pow(2, n);
    return v;
  }

  readString(): string {
    let s = "";
    for (;;) {
      const c = this.read(8);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

function parseKv(data: Uint8Array): Record<string, string> {
  const markerText = "[END OF ASCII HEADER DATA]";
  // Decode single-byte bytes directly: Expo's winter runtime TextDecoder only
  // supports utf-8 (no "latin1"), so avoid it entirely. The header is small.
  const SCAN_LIMIT = 65536;
  let ascii = "";
  const scanEnd = Math.min(data.length, SCAN_LIMIT);
  for (let i = 0; i < scanEnd; i++) ascii += String.fromCharCode(data[i]!);

  const markerEnd = ascii.indexOf(markerText);
  if (markerEnd < 0) throw new TcdError("missing [END OF ASCII HEADER DATA] marker");
  const headerText = ascii.slice(0, markerEnd);

  const kv: Record<string, string> = {};
  for (const line of headerText.split("\n")) {
    const m = line.match(/^\[([^\]]*)\] = ?(.*)$/);
    if (m) kv[m[1]] = (m[2] ?? "").trim();
  }
  return kv;
}

function readFixedStrings(data: Uint8Array, off: { v: number }, count: number, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = "";
    for (let j = 0; j < size; j++) {
      const c = data[off.v + i * size + j];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    if (s === "__END__") break;
    out.push(s);
  }
  off.v += count * size;
  return out;
}

function bitsToBytes(bits: number): number {
  return Math.floor(bits / 8) + (bits % 8 === 0 ? 0 : 1);
}

export function parseInt32(kv: Record<string, string>, key: string): number {
  const v = Number(kv[key]);
  if (!Number.isFinite(v)) throw new TcdError(`missing parseable header field [${key}]`);
  return v;
}

export function parseTcdHeader(data: Uint8Array): TcdHeader {
  const kv = parseKv(data);

  const int = (key: string) => parseInt32(kv, key);

  const majorRev = int("MAJOR REV");
  if (majorRev < 2) throw new TcdError(`only TCD major revision >= 2 supported, got ${majorRev}`);

  const headerSize = int("HEADER SIZE");
  if (headerSize < 0 || headerSize + 4 > data.length) {
    throw new TcdError(`invalid HEADER SIZE ${headerSize}`);
  }

  const crcStored =
    data[headerSize] * 0x1000000 + data[headerSize + 1] * 0x10000 + data[headerSize + 2] * 0x100 + data[headerSize + 3];
  const crcComputed = crc32(data, 0, headerSize);

  const off = { v: headerSize + 4 };

  const levelUnits = readFixedStrings(data, off, int("LEVEL UNIT TYPES"), int("LEVEL UNIT SIZE"));
  const dirUnits = readFixedStrings(data, off, int("DIRECTION UNIT TYPES"), int("DIRECTION UNIT SIZE"));
  const restrictions = readFixedStrings(data, off, Math.pow(2, int("RESTRICTION BITS")), int("RESTRICTION SIZE"));
  const tzfiles = readFixedStrings(data, off, Math.pow(2, int("TZFILE BITS")), int("TZFILE SIZE"));
  const countries = readFixedStrings(data, off, Math.pow(2, int("COUNTRY BITS")), int("COUNTRY SIZE"));
  const datums = readFixedStrings(data, off, Math.pow(2, int("DATUM BITS")), int("DATUM SIZE"));
  const legaleses = readFixedStrings(data, off, Math.pow(2, int("LEGALESE BITS")), int("LEGALESE SIZE"));
  const constituents = readFixedStrings(data, off, int("CONSTITUENTS"), int("CONSTITUENT SIZE"));

  const speedBits = int("CONSTITUENTS") * int("SPEED BITS");
  const equilBits = int("CONSTITUENTS") * int("NUMBER OF YEARS") * int("EQUILIBRIUM BITS");
  const nodeBits = int("CONSTITUENTS") * int("NUMBER OF YEARS") * int("NODE BITS");
  off.v += bitsToBytes(speedBits) + bitsToBytes(equilBits) + bitsToBytes(nodeBits);

  const fields: Record<string, number> = {};
  const wanted = [
    "RECORD SIZE BITS",
    "RECORD TYPE BITS",
    "LATITUDE BITS",
    "LATITUDE SCALE",
    "LONGITUDE BITS",
    "LONGITUDE SCALE",
    "TZFILE BITS",
    "STATION BITS",
    "COUNTRY BITS",
    "RESTRICTION BITS",
    "LEGALESE BITS",
    "DATE BITS",
    "DIRECTION UNIT BITS",
    "DIRECTION BITS",
    "LEVEL UNIT BITS",
    "DATUM OFFSET BITS",
    "DATUM OFFSET SCALE",
    "DATUM BITS",
    "TIME BITS",
    "MONTHS ON STATION BITS",
    "CONFIDENCE VALUE BITS",
    "CONSTITUENT BITS",
    "AMPLITUDE BITS",
    "AMPLITUDE SCALE",
    "EPOCH BITS",
    "EPOCH SCALE",
    "LEVEL ADD BITS",
    "LEVEL ADD SCALE",
    "LEVEL MULTIPLY BITS",
    "LEVEL MULTIPLY SCALE",
    "CONSTITUENTS",
    "NUMBER OF RECORDS",
  ];
  for (const key of wanted) fields[key] = int(key);

  return {
    version: kv["VERSION"] ?? "",
    majorRev,
    minorRev: int("MINOR REV"),
    lastModified: kv["LAST MODIFIED"] ?? "",
    headerSize,
    numberOfRecords: int("NUMBER OF RECORDS"),
    startYear: int("START YEAR"),
    numberOfYears: int("NUMBER OF YEARS"),
    endOfFile: int("END OF FILE"),
    constituents,
    tzfiles,
    levelUnits,
    dirUnits,
    restrictions,
    countries,
    datums,
    legaleses,
    fields,
    crcStored,
    crcComputed,
    crcValid: crcStored === crcComputed,
    recordsStartByte: off.v,
  };
}

export function parseRecordIndex(data: Uint8Array, header: TcdHeader): RecordMeta[] {
  const f = header.fields;
  const records: RecordMeta[] = [];
  let bit = header.recordsStartByte * 8;

  for (let i = 0; i < header.numberOfRecords; i++) {
    const r = new BitReader(data, bit);
    const recordSize = r.read(f["RECORD SIZE BITS"]);
    const type = r.read(f["RECORD TYPE BITS"]) as 1 | 2;
    const latitude = r.readSigned(f["LATITUDE BITS"]) / f["LATITUDE SCALE"];
    const longitude = r.readSigned(f["LONGITUDE BITS"]) / f["LONGITUDE SCALE"];
    const timezoneIndex = r.read(f["TZFILE BITS"]);
    const name = r.readString();
    const referenceStation = r.readSigned(f["STATION BITS"]);
    records.push({
      index: i,
      type,
      recordSize,
      recordStartBit: bit,
      latitude,
      longitude,
      timezoneIndex,
      name,
      referenceStation,
    });
    bit += recordSize * 8;
  }
  return records;
}

export function parseReferenceStation(data: Uint8Array, header: TcdHeader, meta: RecordMeta): ReferenceStation {
  if (meta.type !== 1) throw new TcdError("parseReferenceStation called on a non-reference record");
  const f = header.fields;
  const r = new BitReader(data, meta.recordStartBit);

  r.read(f["RECORD SIZE BITS"]);
  r.read(f["RECORD TYPE BITS"]);
  const latitude = r.readSigned(f["LATITUDE BITS"]) / f["LATITUDE SCALE"];
  const longitude = r.readSigned(f["LONGITUDE BITS"]) / f["LONGITUDE SCALE"];
  const timezoneIndex = r.read(f["TZFILE BITS"]);
  const name = r.readString();
  r.readSigned(f["STATION BITS"]);
  const countryName = header.countries[r.read(f["COUNTRY BITS"])] ?? "";
  const source = r.readString();
  r.read(f["RESTRICTION BITS"]);
  r.readString();
  r.readString();
  r.read(f["LEGALESE BITS"]);
  const stationIdContext = r.readString();
  const stationId = r.readString();
  r.read(f["DATE BITS"]);
  r.readString();
  r.read(f["DIRECTION UNIT BITS"]);
  r.read(f["DIRECTION BITS"]);
  r.read(f["DIRECTION BITS"]);
  const levelUnit = header.levelUnits[r.read(f["LEVEL UNIT BITS"])] ?? "";
  const datumOffset = r.readSigned(f["DATUM OFFSET BITS"]) / f["DATUM OFFSET SCALE"];
  const datum = header.datums[r.read(f["DATUM BITS"])] ?? "";
  r.readSigned(f["TIME BITS"]);
  r.read(f["DATE BITS"]);
  const monthsOnStation = r.read(f["MONTHS ON STATION BITS"]);
  r.read(f["DATE BITS"]);
  const confidence = r.read(f["CONFIDENCE VALUE BITS"]);
  const count = r.read(f["CONSTITUENT BITS"]);

  const constituents: TideConstituent[] = [];
  for (let i = 0; i < count; i++) {
    const j = r.read(f["CONSTITUENT BITS"]);
    const amplitude = r.read(f["AMPLITUDE BITS"]) / f["AMPLITUDE SCALE"];
    const phase = r.read(f["EPOCH BITS"]) / f["EPOCH SCALE"];
    constituents.push({ name: header.constituents[j] ?? `c${j}`, amplitude, phase });
  }

  return {
    index: meta.index,
    type: 1,
    name,
    country: countryName,
    timezone: header.tzfiles[timezoneIndex] ?? "",
    latitude,
    longitude,
    id: `${stationIdContext}/${stationId}`,
    stationIdContext,
    stationId,
    source,
    datum,
    datumOffset,
    levelUnit,
    monthsOnStation,
    confidence,
    constituents,
  };
}

export function parseReferenceStations(data: Uint8Array, header: TcdHeader): ReferenceStation[] {
  const metas = parseRecordIndex(data, header);
  const out: ReferenceStation[] = [];
  for (const meta of metas) {
    if (meta.type === 1) out.push(parseReferenceStation(data, header, meta));
  }
  return out;
}