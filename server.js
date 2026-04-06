const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Store rooms: { roomId: [socketIds] }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId, callback) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    const participants = rooms.get(roomId);
    
    // Get existing participants (excluding current socket)
    const existingUsers = Array.from(participants);
    participants.add(socket.id);
    
    // Notify existing users about new participant
    socket.to(roomId).emit('user-connected', socket.id);
    
    // Send the new user the list of existing participants
    callback(existingUsers);
    
    // Handle disconnection
    socket.on('disconnect', () => {
      participants.delete(socket.id);
      if (participants.size === 0) {
        rooms.delete(roomId);
      }
      socket.to(roomId).emit('user-disconnected', socket.id);
    });
  });
  
  // Relay WebRTC signaling (offer, answer, ice-candidate)
  socket.on('signal', ({ to, from, signal }) => {
    io.to(to).emit('signal', { from, signal });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ntumeet server running on http://localhost:${PORT}`);
});
