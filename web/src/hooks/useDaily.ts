import { useCallback, useEffect, useRef, useState } from "react";
import DailyIframe, {
  type DailyCall,
  type DailyEventObjectParticipant,
  type DailyEventObjectParticipantLeft,
  type DailyEventObjectNetworkQualityEvent,
} from "@daily-co/daily-js";
import type { DailyCallState, DailyParticipant, DailySdkEvent, NetworkQuality } from "@/types/daily";

interface UseDailyOptions {
  roomUrl: string;
  token: string;
  /** Called when SDK fires an event we care about — triggers immediate server poll */
  onSdkEvent?: (event: DailySdkEvent) => void;
  onError?: (error: string) => void;
}

const initialState: DailyCallState = {
  isJoined: false,
  isMuted: false,
  networkQuality: "unknown",
  micLevel: 0,
  participants: [],
  error: null,
  localConnectionId: null,
  localUserId: null,
};

function mapParticipant(p: Record<string, unknown>): DailyParticipant {
  return {
    session_id: String(p.session_id ?? ""),
    user_id: String(p.user_id ?? ""),
    user_name: String(p.user_name ?? ""),
    local: Boolean(p.local),
    audio: Boolean(p.audio),
    owner: Boolean(p.owner),
  };
}

export function useDaily({ roomUrl, token, onSdkEvent, onError }: UseDailyOptions) {
  const [state, setState] = useState<DailyCallState>(initialState);
  const callRef = useRef<DailyCall | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const updateParticipants = useCallback((call: DailyCall) => {
    const allParticipants = call.participants();
    const mapped: DailyParticipant[] = Object.values(allParticipants).map(
      (p) => mapParticipant(p as unknown as Record<string, unknown>),
    );

    // Extract local user's connection_id and user_id
    const local = allParticipants.local;
    const rawLocal = local as unknown as Record<string, unknown>;
    const localConnectionId = local ? String(rawLocal.session_id ?? "") : null;
    const localUserId = local ? String(rawLocal.user_id ?? "") : null;

    setState((prev) => ({
      ...prev,
      participants: mapped,
      localConnectionId,
      localUserId,
    }));
  }, []);

  const startMicLevelMonitor = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAnalyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] ?? 0;
        }
        const avg = sum / dataArray.length / 255;
        setState((prev) => ({ ...prev, micLevel: avg }));
        animFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      // AudioContext not available
    }
  }, []);

  const join = useCallback(async () => {
    if (callRef.current) return;

    try {
      const call = DailyIframe.createCallObject({
        audioSource: true,
        videoSource: false,
      });

      callRef.current = call;

      call.on("joined-meeting", () => {
        setState((prev) => ({ ...prev, isJoined: true, error: null }));
        updateParticipants(call);

        // Start mic level monitoring
        const tracks = call.participants().local?.tracks;
        const audioTrack = tracks?.audio?.persistentTrack;
        if (audioTrack) {
          const stream = new MediaStream([audioTrack]);
          startMicLevelMonitor(stream);
        }
      });

      call.on("left-meeting", () => {
        setState(initialState);
      });

      // Participant events — update local SDK state + trigger server poll
      call.on(
        "participant-joined",
        (_event?: DailyEventObjectParticipant) => {
          updateParticipants(call);
          onSdkEvent?.("participant-joined");
        },
      );

      call.on(
        "participant-left",
        (_event?: DailyEventObjectParticipantLeft) => {
          updateParticipants(call);
          onSdkEvent?.("participant-left");
        },
      );

      call.on("participant-updated", () => {
        updateParticipants(call);
      });

      call.on(
        "network-quality-change",
        (event?: DailyEventObjectNetworkQualityEvent) => {
          if (!event) return;
          const quality = event.threshold as string;
          let mapped: NetworkQuality = "unknown";
          if (quality === "good") mapped = "good";
          else if (quality === "low") mapped = "warning";
          else if (quality === "very-low") mapped = "bad";

          setState((prev) => ({ ...prev, networkQuality: mapped }));
        },
      );

      // Recording events — only trigger server poll (server owns recording state)
      call.on("recording-started", () => {
        onSdkEvent?.("recording-started");
      });

      call.on("recording-stopped", () => {
        onSdkEvent?.("recording-stopped");
      });

      call.on("error", (event) => {
        const msg = (event as { errorMsg?: string })?.errorMsg ?? "Call error";
        setState((prev) => ({ ...prev, error: msg }));
        onError?.(msg);
      });

      await call.join({ url: roomUrl, token });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join call";
      setState((prev) => ({ ...prev, error: msg }));
      onError?.(msg);
    }
  }, [roomUrl, token, onSdkEvent, onError, updateParticipants, startMicLevelMonitor]);

  const leave = useCallback(async () => {
    cancelAnimationFrame(animFrameRef.current);
    micAnalyserRef.current = null;

    if (callRef.current) {
      await callRef.current.leave();
      callRef.current.destroy();
      callRef.current = null;
    }
    setState(initialState);
  }, []);

  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    const localAudio = callRef.current.localAudio();
    callRef.current.setLocalAudio(!localAudio);
    setState((prev) => ({ ...prev, isMuted: localAudio }));
  }, []);

  /** Programmatic mute/unmute — used for auto-mute on pause */
  const setMuted = useCallback((muted: boolean) => {
    if (!callRef.current) return;
    callRef.current.setLocalAudio(!muted);
    setState((prev) => ({ ...prev, isMuted: muted }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (callRef.current) {
        callRef.current.leave().catch(() => {});
        callRef.current.destroy();
        callRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    join,
    leave,
    toggleMute,
    setMuted,
  };
}
