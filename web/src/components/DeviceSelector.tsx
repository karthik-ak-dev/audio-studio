/**
 * DeviceSelector.tsx — Microphone device picker dropdown.
 *
 * Used in the GreenRoom to let users choose which audio input device
 * to use for their recording session. The selected device ID is passed
 * to `getUserMedia({ audio: { deviceId: { exact: id } } })` by the parent.
 *
 * ## How it works
 *
 * 1. **Permission acquisition** — On mount, requests a temporary audio stream
 *    via `getUserMedia({ audio: true })` to unlock device labels. Without this,
 *    `enumerateDevices()` returns devices with empty labels on most browsers.
 *    The temp stream is immediately stopped (we just need the permission grant).
 *
 * 2. **Device enumeration** — Calls `navigator.mediaDevices.enumerateDevices()`
 *    and filters for `audioinput` kind. Displays device labels in a <select>.
 *
 * 3. **Auto-selection** — If no device is currently selected (initial mount),
 *    automatically selects the first available microphone.
 *
 * 4. **Hot-plug detection** — Listens for the `devicechange` event on
 *    `navigator.mediaDevices`, which fires when a USB mic is plugged in
 *    or unplugged. Re-enumerates devices to keep the list fresh.
 *
 * ## Props
 *
 * - `onDeviceSelected(deviceId)` — Called when user picks a device or on auto-select
 * - `selectedDeviceId` — Currently selected device ID for controlled select
 */

import { useEffect, useState } from 'react';

interface DeviceSelectorProps {
  onDeviceSelected: (deviceId: string) => void;
  selectedDeviceId?: string;
}

export default function DeviceSelector({ onDeviceSelected, selectedDeviceId }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    async function loadDevices() {
      // Request a temporary stream to unlock device labels.
      // Without this, enumerateDevices() returns empty labels on most browsers.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // Release immediately
      } catch {
        // Permission denied — we'll still list devices but without readable labels
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');
      setDevices(audioInputs);

      // Auto-select first device if none selected
      if (!selectedDeviceId && audioInputs.length > 0) {
        onDeviceSelected(audioInputs[0].deviceId);
      }
    }

    loadDevices();

    // Re-enumerate when devices are plugged in or removed
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <label className="block mb-1 text-sm text-surface-400">Microphone</label>
      <select
        className="w-full px-3 py-2 text-surface-50 bg-surface-800 border border-surface-600 rounded-lg"
        value={selectedDeviceId || ''}
        onChange={(e) => onDeviceSelected(e.target.value)}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {/* Fallback label for devices where permission wasn't granted */}
            {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
