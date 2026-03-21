import { io } from 'socket.io-client';

// Connect directly to the Flask-SocketIO server.
// Use polling-first: establishes connection immediately, then upgrades to
// WebSocket automatically if the server supports it.
const BACKEND = 'http://localhost:5001';

const socket = io(BACKEND, {
  transports: ['polling', 'websocket'],   // polling first — always works
  upgrade: true,                           // upgrade to WS once connected
  reconnectionAttempts: 20,
  reconnectionDelay: 3000,
  reconnectionDelayMax: 10000,
  timeout: 10000,
  autoConnect: true,
  withCredentials: false,
});

socket.on('connect',            () => console.log('[Socket] connected via', socket.io.engine.transport.name));
socket.on('disconnect', reason  => console.log('[Socket] disconnected:', reason));
socket.on('connect_error', err  => console.warn('[Socket] error:', err.message));
socket.io.engine?.on?.('upgrade', () => console.log('[Socket] upgraded to WebSocket'));

export default socket;
