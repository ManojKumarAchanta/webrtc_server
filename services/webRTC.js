// WebRTC Configuration and Helper Functions
const webRTCConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

class WebRTCService {
  constructor() {
    this.peerConnections = new Map(); // userId -> RTCPeerConnection
    this.localStreams = new Map(); // userId -> MediaStream
    this.remoteStreams = new Map(); // userId -> MediaStream
  }

  // Initialize peer connection for a user
  createPeerConnection(
    userId,
    onIceCandidate,
    onRemoteStream,
    onConnectionStateChange
  ) {
    if (this.peerConnections.has(userId)) {
      this.closePeerConnection(userId);
    }

    const pc = new RTCPeerConnection(webRTCConfig);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      this.remoteStreams.set(userId, remoteStream);
      onRemoteStream(remoteStream);
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${userId}:`, pc.connectionState);
      onConnectionStateChange(pc.connectionState);

      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.closePeerConnection(userId);
      }
    };

    this.peerConnections.set(userId, pc);
    return pc;
  }

  // Add local stream to peer connection
  addLocalStream(userId, stream) {
    const pc = this.peerConnections.get(userId);
    if (pc && stream) {
      this.localStreams.set(userId, stream);
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }
  }

  // Create and send offer
  async createOffer(userId) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return null;

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      return offer;
    } catch (error) {
      console.error("Error creating offer:", error);
      return null;
    }
  }

  // Create and send answer
  async createAnswer(userId, offer) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return null;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return answer;
    } catch (error) {
      console.error("Error creating answer:", error);
      return null;
    }
  }

  // Handle received answer
  async handleAnswer(userId, answer) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  }

  // Handle received ICE candidate
  async handleIceCandidate(userId, candidate) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  }

  // Close peer connection
  closePeerConnection(userId) {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(userId);
    }

    const localStream = this.localStreams.get(userId);
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      this.localStreams.delete(userId);
    }

    this.remoteStreams.delete(userId);
  }

  // Get connection stats
  async getConnectionStats(userId) {
    const pc = this.peerConnections.get(userId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      const result = {};

      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.mediaType === "audio") {
          result.audioInbound = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
          };
        } else if (
          report.type === "inbound-rtp" &&
          report.mediaType === "video"
        ) {
          result.videoInbound = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight,
            framesPerSecond: report.framesPerSecond,
          };
        }
      });

      return result;
    } catch (error) {
      console.error("Error getting connection stats:", error);
      return null;
    }
  }

  // Clean up all connections
  cleanup() {
    for (const userId of this.peerConnections.keys()) {
      this.closePeerConnection(userId);
    }
  }
}

// Media constraints for different call types
const mediaConstraints = {
  audio: {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  },
  video: {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: {
      width: { min: 640, ideal: 1280, max: 1920 },
      height: { min: 480, ideal: 720, max: 1080 },
      frameRate: { min: 15, ideal: 30, max: 60 },
    },
  },
  screen: {
    audio: true,
    video: {
      cursor: "always",
      displaySurface: "monitor",
    },
  },
};

module.exports = {
  WebRTCService,
  webRTCConfig,
  mediaConstraints,
};
