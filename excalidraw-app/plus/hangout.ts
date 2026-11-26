import { atom, appJotaiStore } from "../app-jotai";

import { cloudSession } from "./cloud";
import { connectionIdAtom, participantsAtom } from "./state";

import type { SignalMessage } from "./cloud";

/**
 * Voice hangouts and screen sharing on a cloud scene: a WebRTC mesh between
 * everyone in the hangout, signaled through the scene's event stream. Uses
 * the "perfect negotiation" pattern so either side can add or remove tracks
 * (e.g. start a screen share) at any time.
 */

export type HangoutState = {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  sharingScreen: boolean;
  error: string | null;
  /** Remote media by connection id. */
  remote: Record<
    string,
    { audio: MediaStream | null; screen: MediaStream | null }
  >;
  /** Our own screen share, for the local preview. */
  localScreen: MediaStream | null;
};

const initialState: HangoutState = {
  joined: false,
  joining: false,
  muted: false,
  sharingScreen: false,
  error: null,
  remote: {},
  localScreen: null,
};

export const hangoutAtom = atom<HangoutState>(initialState);

const getIceServers = (): RTCIceServer[] => {
  try {
    const configured = import.meta.env.VITE_APP_PLUS_ICE_SERVERS;
    if (configured) {
      return JSON.parse(configured);
    }
  } catch (error) {
    console.warn("Invalid VITE_APP_PLUS_ICE_SERVERS", error);
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
};

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  screenSender: RTCRtpSender | null;
};

class Hangout {
  private peers = new Map<string, Peer>();
  private microphone: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private unsubscribe: (() => void) | null = null;

  private set(patch: Partial<HangoutState>) {
    appJotaiStore.set(hangoutAtom, {
      ...appJotaiStore.get(hangoutAtom),
      ...patch,
    });
  }

  private setRemote(
    peerId: string,
    patch: Partial<HangoutState["remote"][string]> | null,
  ) {
    const remote = { ...appJotaiStore.get(hangoutAtom).remote };
    if (patch === null) {
      delete remote[peerId];
    } else {
      remote[peerId] = {
        ...(remote[peerId] ?? { audio: null, screen: null }),
        ...patch,
      };
    }
    this.set({ remote });
  }

  isJoined() {
    return appJotaiStore.get(hangoutAtom).joined;
  }

  async join() {
    if (this.isJoined() || appJotaiStore.get(hangoutAtom).joining) {
      return;
    }
    this.set({ joining: true, error: null });
    try {
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error: any) {
      this.set({
        joining: false,
        error:
          error?.name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it in your browser to join."
            : "Couldn't start your microphone.",
      });
      return;
    }
    this.unsubscribe = cloudSession.onSignal(this.onSignal);
    this.set({ joined: true, joining: false, muted: false });
    try {
      await cloudSession.signal("hangout-join");
    } catch (error) {
      this.leave();
      this.set({ error: "Couldn't join the hangout. Check your connection." });
      return;
    }
    // we call everyone already in; they answer
    const me = appJotaiStore.get(connectionIdAtom);
    for (const participant of appJotaiStore.get(participantsAtom)) {
      if (participant.inHangout && participant.connectionId !== me) {
        this.getPeer(participant.connectionId);
      }
    }
  }

  leave() {
    if (!this.isJoined()) {
      return;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const peer of this.peers.values()) {
      peer.pc.close();
    }
    this.peers.clear();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.screen?.getTracks().forEach((track) => track.stop());
    this.microphone = null;
    this.screen = null;
    appJotaiStore.set(hangoutAtom, initialState);
    cloudSession.signal("hangout-leave").catch(() => {});
  }

  toggleMute() {
    const muted = !appJotaiStore.get(hangoutAtom).muted;
    this.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.set({ muted });
  }

  async startScreenShare() {
    if (!this.isJoined() || this.screen) {
      return;
    }
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
    } catch {
      // the user cancelled the picker
      return;
    }
    const [track] = this.screen.getVideoTracks();
    // the browser's own "Stop sharing" button ends the track
    track.addEventListener("ended", () => this.stopScreenShare());
    for (const peer of this.peers.values()) {
      peer.screenSender = peer.pc.addTrack(track, this.screen);
    }
    this.set({ sharingScreen: true, localScreen: this.screen });
    cloudSession.signal("screen-share-start").catch(() => {});
  }

  stopScreenShare() {
    if (!this.screen) {
      return;
    }
    for (const peer of this.peers.values()) {
      if (peer.screenSender) {
        peer.pc.removeTrack(peer.screenSender);
        peer.screenSender = null;
      }
    }
    this.screen.getTracks().forEach((track) => track.stop());
    this.screen = null;
    this.set({ sharingScreen: false, localScreen: null });
    cloudSession.signal("screen-share-stop").catch(() => {});
  }

  private getPeer(peerId: string): Peer {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing;
    }
    const me = appJotaiStore.get(connectionIdAtom) ?? "";
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    const peer: Peer = {
      id: peerId,
      pc,
      // the side with the smaller id yields on offer collisions
      polite: me < peerId,
      makingOffer: false,
      ignoreOffer: false,
      screenSender: null,
    };
    this.peers.set(peerId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        await cloudSession.signal("rtc-offer", pc.localDescription, peerId);
      } catch (error) {
        console.warn("Negotiation failed", error);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        cloudSession
          .signal("rtc-ice", candidate.toJSON(), peerId)
          .catch(() => {});
      }
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === "audio") {
        this.setRemote(peerId, { audio: stream });
      } else {
        this.setRemote(peerId, { screen: stream });
        const clear = () => {
          if (
            appJotaiStore.get(hangoutAtom).remote[peerId]?.screen === stream
          ) {
            this.setRemote(peerId, { screen: null });
          }
        };
        track.addEventListener("ended", clear);
        stream.addEventListener("removetrack", clear);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        pc.restartIce();
      }
    };

    this.microphone
      ?.getTracks()
      .forEach((track) => pc.addTrack(track, this.microphone!));
    if (this.screen) {
      peer.screenSender = pc.addTrack(
        this.screen.getVideoTracks()[0],
        this.screen,
      );
    }
    return peer;
  }

  private closePeer(peerId: string) {
    this.peers.get(peerId)?.pc.close();
    this.peers.delete(peerId);
    this.setRemote(peerId, null);
  }

  private onSignal = async (message: SignalMessage) => {
    if (!this.isJoined()) {
      return;
    }
    switch (message.type) {
      case "hangout-leave":
        this.closePeer(message.from);
        return;
      case "screen-share-stop":
        this.setRemote(message.from, { screen: null });
        return;
      case "rtc-offer":
      case "rtc-answer": {
        const description = message.data as RTCSessionDescriptionInit;
        const peer = this.getPeer(message.from);
        const { pc } = peer;
        const collision =
          description.type === "offer" &&
          (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) {
          return;
        }
        try {
          await pc.setRemoteDescription(description);
          if (description.type === "offer") {
            await pc.setLocalDescription();
            await cloudSession.signal(
              "rtc-answer",
              pc.localDescription,
              message.from,
            );
          }
        } catch (error) {
          console.warn("Couldn't apply remote description", error);
        }
        return;
      }
      case "rtc-ice": {
        const peer = this.peers.get(message.from);
        if (!peer) {
          return;
        }
        try {
          await peer.pc.addIceCandidate(message.data);
        } catch (error) {
          if (!peer.ignoreOffer) {
            console.warn("Bad ICE candidate", error);
          }
        }
      }
    }
  };
}

export const hangout = new Hangout();
