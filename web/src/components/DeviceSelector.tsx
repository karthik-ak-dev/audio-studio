import { useEffect, useState } from 'react';

interface DeviceSelectorProps {
  onDeviceSelected: (deviceId: string) => void;
  selectedDeviceId?: string;
}

export default function DeviceSelector({ onDeviceSelected, selectedDeviceId }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    async function loadDevices() {
      // Request permission first to get device labels
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied — we'll still list devices without labels
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

    // Listen for device changes (plug/unplug)
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">Microphone</label>
      <select
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
        value={selectedDeviceId || ''}
        onChange={(e) => onDeviceSelected(e.target.value)}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
