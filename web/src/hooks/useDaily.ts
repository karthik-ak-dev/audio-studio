import { useCallback, useEffect, useRef, useState } from "react";
import DailyIframe, {
  type DailyCall,
  type DailyEventObjectParticipant,
  type DailyEventObjectParticipantLeft,
  type DailyEventObjectNetworkQualityEvent,
} from "@daily-co/daily-js";
import type { AppMessage, DailyCallState, DailyParticipant, DailySdkEvent, NetworkQuality } from "@/types/daily";

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
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  /** Remote mute state from app-message (track.enabled doesn't update SDK's participant.audio for peers) */
  const remoteMuteRef = useRef<Map<string, boolean>>(new Map());

  /** Attach or detach <audio> elements for remote participants' audio tracks. */
  const syncRemoteAudio = useCallback((call: DailyCall) => {
    const participants = call.participants();
    const activeIds = new Set<string>();

    for (const [key, p] of Object.entries(participants)) {
      if (key === "local") continue;
      const sessionId = String((p as unknown as Record<string, unknown>).session_id ?? "");
      if (!sessionId) continue;
      activeIds.add(sessionId);

      const track = p.tracks?.audio?.persistentTrack;
      if (!track) {
        // No track — clean up any existing element
        const el = remoteAudioRefs.current.get(sessionId);
        if (el) {
          el.srcObject = null;
          el.remove();
          remoteAudioRefs.current.delete(sessionId);
        }
        continue;
      }

      // Already attached to this track
      const existing = remoteAudioRefs.current.get(sessionId);
      if (existing && existing.srcObject instanceof MediaStream) {
        const existingTrack = existing.srcObject.getAudioTracks()[0];
        if (existingTrack?.id === track.id) continue;
      }

      // Create or reuse <audio> element
      const el = existing ?? document.createElement("audio");
      el.autoplay = true;
      // Prevent echo — never attach local audio to a speaker
      el.srcObject = new MediaStream([track]);
      if (!existing) {
        remoteAudioRefs.current.set(sessionId, el);
      }
    }

    // Remove elements for participants who left
    for (const [sessionId, el] of remoteAudioRefs.current) {
      if (!activeIds.has(sessionId)) {
        el.srcObject = null;
        el.remove();
        remoteAudioRefs.current.delete(sessionId);
      }
    }
  }, []);

  const updateParticipants = useCallback((call: DailyCall) => {
    const allParticipants = call.participants();
    const mapped: DailyParticipant[] = Object.values(allParticipants).map(
      (p) => mapParticipant(p as unknown as Record<string, unknown>),
    );

    // Patch remote audio state from app-message overrides
    // (track.enabled doesn't update SDK's participant.audio for remote peers)
    for (const m of mapped) {
      const muted = remoteMuteRef.current.get(m.session_id);
      if (!m.local && muted !== undefined) {
        m.audio = !muted;
      }
    }

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
        setState((prev) => ({ ...prev, isJoined: true, networkQuality: "good" as NetworkQuality, error: null }));
        updateParticipants(call);
        syncRemoteAudio(call);

        // Start mic level monitoring
        const tracks = call.participants().local?.tracks;
        const audioTrack = tracks?.audio?.persistentTrack;
        if (audioTrack) {
          const stream = new MediaStream([audioTrack]);
          startMicLevelMonitor(stream);
        }
      });

      // Participant events — update local SDK state, sync remote audio, trigger server poll
      call.on(
        "participant-joined",
        (_event?: DailyEventObjectParticipant) => {
          updateParticipants(call);
          syncRemoteAudio(call);
          onSdkEvent?.("participant-joined");

          // Re-broadcast our mute state so the new participant picks it up
          // (track.enabled doesn't propagate via SFU)
          const localTrack = call.participants().local?.tracks?.audio?.persistentTrack;
          if (localTrack && !localTrack.enabled) {
            call.sendAppMessage({ type: "mute-state", muted: true }, "*");
          }
        },
      );

      call.on(
        "participant-left",
        (_event?: DailyEventObjectParticipantLeft) => {
          if (_event?.participant?.session_id) {
            remoteMuteRef.current.delete(String(_event.participant.session_id));
          }
          updateParticipants(call);
          syncRemoteAudio(call);
          onSdkEvent?.("participant-left");
        },
      );

      call.on("participant-updated", () => {
        updateParticipants(call);
        syncRemoteAudio(call);
      });

      // App-message — peer-to-peer state sync (mute, future: chat)
      call.on("app-message", (event?: { data: AppMessage; fromId: string }) => {
        if (!event) return;
        const { data, fromId } = event;
        switch (data.type) {
          case "mute-state":
            remoteMuteRef.current.set(fromId, data.muted);
            updateParticipants(call);
            break;
        }
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

      // Ejected — Daily removed us because another tab joined with the same user_id
      // (enforce_unique_user_ids is enabled on the room)
      call.on("left-meeting", (event) => {
        const reason = (event as { action?: string })?.action;
        if (reason === "ejected") {
          callRef.current = null;
          call.destroy();
          setState(initialState);
          onError?.("This session was opened in another tab.");
          return;
        }
        setState(initialState);
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
  }, [roomUrl, token, onSdkEvent, onError, updateParticipants, syncRemoteAudio, startMicLevelMonitor]);

  const cleanupRemoteAudio = useCallback(() => {
    for (const [, el] of remoteAudioRefs.current) {
      el.srcObject = null;
      el.remove();
    }
    remoteAudioRefs.current.clear();
  }, []);

  const leave = useCallback(async () => {
    cancelAnimationFrame(animFrameRef.current);
    micAnalyserRef.current = null;
    cleanupRemoteAudio();

    if (callRef.current) {
      await callRef.current.leave();
      callRef.current.destroy();
      callRef.current = null;
    }
    setState(initialState);
  }, [cleanupRemoteAudio]);

  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    // Use track.enabled instead of setLocalAudio() so that Daily's SFU
    // keeps receiving silent frames during mute. This ensures raw-tracks
    // recording captures silence (preserving timeline) rather than
    // stripping the muted period and causing merge drift.
    const track = callRef.current.participants().local?.tracks?.audio?.persistentTrack;
    if (!track) return;
    track.enabled = !track.enabled;
    const muted = !track.enabled;
    setState((prev) => ({ ...prev, isMuted: muted }));
    // Broadcast mute state to remote peers (track.enabled doesn't update
    // Daily's participant.audio for others)
    callRef.current.sendAppMessage({ type: "mute-state", muted }, "*");
  }, []);

  /** Programmatic mute/unmute — used for auto-mute on pause */
  const setMuted = useCallback((muted: boolean) => {
    if (!callRef.current) return;
    const track = callRef.current.participants().local?.tracks?.audio?.persistentTrack;
    if (!track) return;
    track.enabled = !muted;
    setState((prev) => ({ ...prev, isMuted: muted }));
    callRef.current.sendAppMessage({ type: "mute-state", muted }, "*");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      for (const [, el] of remoteAudioRefs.current) {
        el.srcObject = null;
        el.remove();
      }
      remoteAudioRefs.current.clear();
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
