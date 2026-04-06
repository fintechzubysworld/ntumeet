// DOM elements
const videoGrid = document.getElementById('videoGrid');
const roomIdInput = document.getElementById('roomIdInput');
const joinBtn = document.getElementById('joinBtn');
const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const shareScreenBtn = document.getElementById('shareScreen');
const endCallBtn = document.getElementById('endCall');

// Global state
let socket = null;
let localStream = null;
let screenStream = null;
let peers = new Map();       // socketId -> peer instance
let currentRoomId = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;

// STUN servers (free, public)
const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Helper: create video element for a participant
function createVideoElement(socketId, label = 'Participant', isLocal = false) {
  const container = document.createElement('div');
  container.className = 'video-container';
  container.id = `container-${socketId}`;
  
  const video = document.createElement('video');
  video.id = `video-${socketId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal; // Mute local video to avoid feedback
  
  const nameTag = document.createElement('div');
  nameTag.className = 'video-label';
  nameTag.innerText = isLocal ? `You (${label})` : label;
  
  container.appendChild(video);
  container.appendChild(nameTag);
  videoGrid.appendChild(container);
  return { container, video };
}

// Remove video element by socketId
function removeVideoElement(socketId) {
  const container = document.getElementById(`container-${socketId}`);
  if (container) container.remove();
}

// Attach stream to video element
function attachStreamToVideo(socketId, stream) {
  const video = document.getElementById(`video-${socketId}`);
  if (video && stream) {
    video.srcObject = stream;
  }
}

// Initialize local media (camera + mic)
async function initLocalStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = stream;
    // Show local preview
    createVideoElement(socket.id, 'Camera', true);
    attachStreamToVideo(socket.id, stream);
    return stream;
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Cannot access camera/microphone. Please check permissions.');
    throw err;
  }
}

// Create a peer connection to another user
function createPeerConnection(socketId, initiator, streamToSend) {
  const peer = new SimplePeer({
    initiator: initiator,
    stream: streamToSend,
    config: peerConfig,
    trickle: true
  });
  
  peer.on('signal', (signal) => {
    // Send signaling data via socket server
    socket.emit('signal', { to: socketId, from: socket.id, signal });
  });
  
  peer.on('stream', (remoteStream) => {
    // New stream from remote peer
    attachStreamToVideo(socketId, remoteStream);
  });
  
  peer.on('close', () => {
    removeVideoElement(socketId);
    peers.delete(socketId);
  });
  
  peer.on('error', (err) => {
    console.error(`Peer error with ${socketId}:`, err);
  });
  
  return peer;
}

// Handle incoming signaling messages
function setupSignaling() {
  socket.on('signal', async ({ from, signal }) => {
    let peer = peers.get(from);
    // If no peer yet, create one as non-initiator (answerer)
    if (!peer) {
      peer = createPeerConnection(from, false, localStream);
      peers.set(from, peer);
    }
    peer.signal(signal);
  });
  
  socket.on('user-connected', (newUserId) => {
    console.log('New user connected:', newUserId);
    // Create a peer for this new user (we are initiator)
    if (newUserId !== socket.id && !peers.has(newUserId)) {
      const peer = createPeerConnection(newUserId, true, localStream);
      peers.set(newUserId, peer);
    }
  });
  
  socket.on('user-disconnected', (userId) => {
    console.log('User disconnected:', userId);
    if (peers.has(userId)) {
      peers.get(userId).destroy();
      peers.delete(userId);
    }
    removeVideoElement(userId);
  });
}

// Join a room
async function joinRoom(roomId) {
  if (!socket) {
    socket = io();
    setupSignaling();
  }
  
  // Clean up previous room connections
  for (let peer of peers.values()) {
    peer.destroy();
  }
  peers.clear();
  videoGrid.innerHTML = '';
  currentRoomId = roomId;
  
  try {
    if (!localStream) {
      await initLocalStream();
    }
    
    socket.emit('join-room', roomId, (existingUsers) => {
      console.log('Existing users in room:', existingUsers);
      // Create peer connections to all existing participants
      existingUsers.forEach(userId => {
        if (userId !== socket.id && !peers.has(userId)) {
          const peer = createPeerConnection(userId, true, localStream);
          peers.set(userId, peer);
        }
      });
    });
  } catch (err) {
    console.error('Failed to join room:', err);
  }
}

// Leave meeting
function leaveMeeting() {
  if (currentRoomId) {
    // Destroy all peer connections
    for (let peer of peers.values()) {
      peer.destroy();
    }
    peers.clear();
    videoGrid.innerHTML = '';
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    socket.disconnect();
    socket = null;
    currentRoomId = null;
    isAudioMuted = false;
    isVideoMuted = false;
    isScreenSharing = false;
    toggleAudioBtn.innerHTML = '🔊 Mute';
    toggleVideoBtn.innerHTML = '📷 Stop Video';
    shareScreenBtn.innerHTML = '🖥️ Share Screen';
    alert('Left the meeting. Refresh page to join again.');
  }
}

// --- Mute/Unmute Audio ---
function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioMuted = !isAudioMuted;
      audioTrack.enabled = !isAudioMuted;
      toggleAudioBtn.innerHTML = isAudioMuted ? '🔇 Unmute' : '🔊 Mute';
    }
  }
}

// --- Stop/Start Video ---
function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isVideoMuted = !isVideoMuted;
      videoTrack.enabled = !isVideoMuted;
      toggleVideoBtn.innerHTML = isVideoMuted ? '📷 Start Video' : '📷 Stop Video';
    }
  }
}

// --- Screen Sharing (replaces video track) ---
async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStream.getVideoTracks()[0].onended = () => {
        // Automatically revert when user stops screen share via browser UI
        stopScreenShare();
      };
      // Replace video track in localStream
      const videoTrack = screenStream.getVideoTracks()[0];
      const oldVideoTrack = localStream.getVideoTracks()[0];
      localStream.removeTrack(oldVideoTrack);
      localStream.addTrack(videoTrack);
      
      // Update all peers with new track
      for (let peer of peers.values()) {
        const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      }
      
      // Update local preview
      attachStreamToVideo(socket.id, localStream);
      
      isScreenSharing = true;
      shareScreenBtn.innerHTML = '🖥️ Stop Share';
      shareScreenBtn.style.background = '#e53e3e';
    } catch (err) {
      console.error('Screen share failed:', err);
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  // Restore camera video track
  const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  const newVideoTrack = cameraStream.getVideoTracks()[0];
  const oldVideoTrack = localStream.getVideoTracks()[0];
  localStream.removeTrack(oldVideoTrack);
  localStream.addTrack(newVideoTrack);
  
  for (let peer of peers.values()) {
    const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(newVideoTrack);
  }
  
  attachStreamToVideo(socket.id, localStream);
  isScreenSharing = false;
  shareScreenBtn.innerHTML = '🖥️ Share Screen';
  shareScreenBtn.style.background = '#2d2d44';
}

// --- Event Listeners ---
joinBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) joinRoom(roomId);
  else alert('Please enter a room ID');
};

toggleAudioBtn.onclick = toggleAudio;
toggleVideoBtn.onclick = toggleVideo;
shareScreenBtn.onclick = toggleScreenShare;
endCallBtn.onclick = leaveMeeting;

// Auto-join demo room on page load (optional)
window.onload = () => {
  joinRoom('demo');
};
