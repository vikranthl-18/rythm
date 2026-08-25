// ---------------------------------------------------------------------------
// Real health devices over Web Bluetooth (Chrome/Edge on HTTPS).
//
// A PWA can't reach Android Health Connect or Apple HealthKit — those are
// native APIs. What the web CAN do today is talk directly to BLE fitness
// devices (HR straps, watches, rings that expose GATT services). We use the
// two standardized services almost every device ships with:
//   - Heart Rate (0x180D / 0x2A37 "heart_rate_measurement", notifications)
//   - Battery (0x180F / 0x2A19)
// Live HR streams straight into the store and replaces the simulated HR.
// ---------------------------------------------------------------------------

export interface PairedBle {
  id: string;
  name: string;
}

interface BleChar {
  startNotifications(): Promise<unknown>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  stopNotifications(): Promise<unknown>;
}
interface BleService {
  getCharacteristic(uuid: string): Promise<BleChar>;
}
interface BleGatt {
  connected: boolean;
  connect(): Promise<{ connected: boolean }>;
  getPrimaryService(uuid: string): Promise<BleService>;
}
interface BleDevice {
  id: string;
  name?: string;
  gatt?: BleGatt;
  addEventListener?(type: string, cb: () => void): void;
  removeEventListener?(type: string, cb: () => void): void;
}
interface BleNavigator {
  bluetooth?: {
    requestDevice(options: unknown): Promise<BleDevice>;
    getDevices?(): Promise<BleDevice[]>;
  };
}

const HR_SERVICE = "heart_rate";
const HR_MEASUREMENT = "heart_rate_measurement";
const BATTERY_SERVICE = "battery_service";
const BATTERY_LEVEL = "battery_level";

export function bluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

const nav = () => navigator as BleNavigator;

/**
 * Parse a Heart Rate Measurement characteristic value (0x2A37).
 * Flags byte: bit 0 = value format (0 → UINT8, 1 → UINT16), bit 3 = RR-interval
 * present. RR intervals are 2-byte little-endian in 1/1024 seconds. Pure, so
 * it's unit-testable without a device.
 */
export function parseHrValue(
  data: DataView
): { bpm: number; rrMs: number[] } | null {
  if (data.byteLength < 2) return null;
  const flags = data.getUint8(0);
  let offset = 1;
  let bpm: number;
  if (flags & 0x01) {
    if (data.byteLength < 3) return null;
    bpm = data.getUint16(1, true);
    offset = 3;
  } else {
    bpm = data.getUint8(1);
    offset = 2;
  }
  const rrMs: number[] = [];
  if (flags & 0x08) {
    while (offset + 1 < data.byteLength) {
      // 1/1024 s per unit → ms
      rrMs.push(Math.round((data.getUint16(offset, true) * 1000) / 1024));
      offset += 2;
    }
  }
  return { bpm, rrMs };
}

function wireStream(
  device: BleDevice,
  onDisconnect: () => void
): { stop: () => void } {
  // Modern Chrome fires 'gattserverdisconnected' on the device.
  device.addEventListener?.("gattserverdisconnected", onDisconnect);
  return { stop: () => device.removeEventListener?.("gattserverdisconnected", onDisconnect) };
}

async function attachHrStream(
  device: BleDevice,
  onHr: (bpm: number) => void,
  onDisconnect: () => void
): Promise<{ stop: () => void }> {
  const gatt = device.gatt;
  if (!gatt) throw new Error("This device has no GATT server.");
  if (!gatt.connected) await gatt.connect();
  const service = await gatt.getPrimaryService(HR_SERVICE);
  const char = await service.getCharacteristic(HR_MEASUREMENT);
  const listener = (e: unknown) => {
    const raw = (e as { target?: { value?: ArrayBuffer } }).target?.value;
    if (!raw) return;
    const parsed = parseHrValue(new DataView(raw));
    if (parsed && parsed.bpm > 0) onHr(parsed.bpm);
  };
  char.addEventListener("characteristicvaluechanged", listener);
  await char.startNotifications();
  const { stop } = wireStream(device, onDisconnect);
  return {
    stop: async () => {
      stop();
      try {
        await char.stopNotifications();
      } catch {
        /* device already gone */
      }
    },
  };
}

/** Battery percentage via the standard Battery Service (0x180F / 0x2A19). */
export async function readBatteryPercent(device: unknown): Promise<number | null> {
  try {
    const d = device as BleDevice;
    const gatt = d.gatt;
    if (!gatt) return null;
    if (!gatt.connected) await gatt.connect();
    const service = await gatt.getPrimaryService(BATTERY_SERVICE);
    const char = await service.getCharacteristic(BATTERY_LEVEL);
    const value = await (char as BleChar & { readValue(): Promise<ArrayBuffer> }).readValue();
    return new DataView(value).getUint8(0);
  } catch {
    return null; // not every device exposes battery — that's fine
  }
}

/**
 * Pair a device and start streaming HR. Throws on cancellation/no-BT; the
 * caller surfaces the error. Returns the paired info + a stop handle.
 */
export async function pairAndStreamHr(
  onHr: (bpm: number) => void,
  onDisconnect: () => void
): Promise<{ info: PairedBle; stop: { stop: () => void } }> {
  const b = nav().bluetooth;
  if (!b) throw new Error("Web Bluetooth is not available in this browser.");
  // Prefer a filter on the standard Heart Rate service so the chooser only
  // shows plausible fitness devices; battery is optional everywhere.
  const device = await b.requestDevice({
    filters: [{ services: [HR_SERVICE] }],
    optionalServices: [BATTERY_SERVICE],
  });
  const info: PairedBle = { id: device.id, name: device.name ?? "BLE device" };
  const stop = await attachHrStream(device, onHr, onDisconnect);
  return { info, stop };
}

/** Reconnect a previously paired device by id (no user gesture needed). */
export async function reconnectBle(
  id: string,
  onHr: (bpm: number) => void,
  onDisconnect: () => void
): Promise<{ info: PairedBle; stop: { stop: () => void } } | null> {
  const b = nav().bluetooth;
  if (!b?.getDevices) return null;
  const devices = await b.getDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return null;
  try {
    const stop = await attachHrStream(device, onHr, onDisconnect);
    return { info: { id: device.id, name: device.name ?? "BLE device" }, stop };
  } catch {
    return null;
  }
}
