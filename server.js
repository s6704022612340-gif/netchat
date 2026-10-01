const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 }); // 10MB

app.use(express.static(path.join(__dirname, 'public')));

// ── Health Check / Keep-Alive Endpoints ────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        users: Object.keys(users).length,
        timestamp: new Date().toISOString()
    });
});
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ── In-memory state ──────────────────────────────────────────
const users = {};   // socketId → User object
const rooms = {
    global: { id: 'global', name: 'Global Lounge (ห้องรวม)', creator: 'System', creatorId: null, members: [] }
};
const roomMessages = { global: [] };
const MSG_LIMIT = 100;

const AVATAR_COLORS = ['#8B5CF6','#A78BFA','#7C3AED','#6366F1','#3B82F6','#EC4899','#F59E0B','#06B6D4'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Helpers ──────────────────────────────────────────────────
function broadcastUserList()   { io.emit('user_list',  Object.values(users));  }
function broadcastRoomList()   { io.emit('room_list',  Object.values(rooms));  }
function sysMsg(roomId, text)  {
    io.to(roomId).emit('system_message', { room: roomId, text, timestamp: new Date().toISOString() });
}

// ── Socket.io ─────────────────────────────────────────────────
io.on('connection', socket => {

    // ── Login ──────────────────────────────────────────────────
    socket.on('login', username => {
        const name     = (String(username || '').trim().slice(0, 25)) || 'Anonymous';
        const isAdmin  = name.toLowerCase() === 'admin';
        const color    = isAdmin ? '#EF4444' : pick(AVATAR_COLORS);

        users[socket.id] = { id: socket.id, username: name, color, isAdmin };

        socket.join('global');
        if (!rooms.global.members.includes(socket.id)) rooms.global.members.push(socket.id);

        socket.emit('login_success', {
            user:    users[socket.id],
            rooms:   Object.values(rooms),
            users:   Object.values(users),
            history: roomMessages.global.slice(-50)
        });

        broadcastUserList();
        broadcastRoomList();
    });

    // ── Ping (Network Latency) ─────────────────────────────────
    socket.on('network_ping', (ts, cb) => {
        if (typeof cb === 'function') cb({ clientTimestamp: ts, serverTimestamp: Date.now(), transport: socket.conn.transport.name });
    });

    // ── Create Room ────────────────────────────────────────────
    socket.on('create_room', (data, cb) => {
        const user = users[socket.id];
        if (!user) return;
        
        const name = typeof data === 'string' ? data : data.name;
        const isPrivate = data.isPrivate || false;
        const allowedUsers = data.allowedUserIds || [];
        
        const roomName = String(name || '').trim().slice(0, 30);
        if (!roomName) return cb?.({ success: false, error: 'กรุณาใส่ชื่อกลุ่ม' });

        const roomId = 'room_' + Date.now();
        rooms[roomId] = { id: roomId, name: roomName, creator: user.username, creatorId: socket.id, members: [socket.id], isPrivate, allowedUsers };
        roomMessages[roomId] = [];

        socket.join(roomId);
        broadcastRoomList();
        cb?.({ success: true, room: rooms[roomId] });
        sysMsg(roomId, `🎉 กลุ่ม "${roomName}" ถูกสร้างโดย ${user.username}`);
    });

    // ── Join Room ──────────────────────────────────────────────
    socket.on('join_room', (roomId, cb) => {
        const user = users[socket.id];
        const room = rooms[roomId];
        if (!user || !room) return cb?.({ success: false, error: 'ไม่พบห้องนี้' });
        
        if (room.isPrivate && room.creatorId !== socket.id && !user.isAdmin) {
            if (!room.allowedUsers || !room.allowedUsers.includes(socket.id)) {
                return cb?.({ success: false, error: 'ห้องนี้เป็นห้องส่วนตัว คุณไม่มีสิทธิ์เข้าร่วม' });
            }
        }

        socket.join(roomId);
        room.members = [...new Set([...room.members, socket.id])];
        broadcastRoomList();
        socket.emit('room_history', { roomId, messages: (roomMessages[roomId] || []).slice(-50) });
        cb?.({ success: true });
    });

    // ── Room Message ───────────────────────────────────────────
    socket.on('send_room_message', data => {
        const user = users[socket.id];
        if (!user || !rooms[data.roomId]) return;
        const msg = {
            id:          'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            roomId:      data.roomId,
            senderId:    socket.id,
            senderName:  user.username,
            senderColor: user.color,
            type:        data.type || 'text',
            content:     data.content,
            fileName:    data.fileName || null,
            fileSize:    data.fileSize || null,
            timestamp:   new Date().toISOString()
        };
        const cache = roomMessages[data.roomId];
        cache.push(msg);
        if (cache.length > MSG_LIMIT) cache.shift();
        io.to(data.roomId).emit('receive_room_message', msg);
    });

    // ── Private Message ────────────────────────────────────────
    socket.on('send_private_message', data => {
        const sender = users[socket.id];
        const target = users[data.targetId];
        if (!sender || !target) {
            socket.emit('system_error', 'ผู้รับไม่ได้ออนไลน์อยู่');
            return;
        }
        const msg = {
            id:          'pmsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            senderId:    socket.id,
            senderName:  sender.username,
            senderColor: sender.color,
            targetId:    data.targetId,
            targetName:  target.username,
            type:        data.type || 'text',
            content:     data.content,
            fileName:    data.fileName || null,
            fileSize:    data.fileSize || null,
            timestamp:   new Date().toISOString()
        };
        io.to(data.targetId).emit('receive_private_message', msg);
        socket.emit('receive_private_message', msg);
    });

    // ── Typing ─────────────────────────────────────────────────
    socket.on('typing_status', data => {
        const user = users[socket.id];
        if (!user) return;
        const { targetType, targetId, isTyping } = data;
        const dest = targetType === 'room' ? socket.to(targetId) : io.to(targetId);
        dest.emit('user_typing', { targetType, targetId: targetType === 'room' ? targetId : socket.id, username: user.username, userId: socket.id, isTyping });
    });

    // ── Delete Room (Admin or Creator) ─────────────────────────
    socket.on('delete_room', roomId => {
        const user = users[socket.id];
        if (!user) return;
        if (roomId === 'global') return socket.emit('system_error', 'ไม่สามารถลบ Global Lounge ได้');
        const room = rooms[roomId];
        if (!room) return;
        if (!user.isAdmin && room.creatorId !== socket.id) return socket.emit('system_error', 'คุณไม่มีสิทธิ์ลบห้องนี้');

        const roomName = room.name;
        delete rooms[roomId];
        delete roomMessages[roomId];
        broadcastRoomList();
        io.emit('room_deleted', { roomId, roomName, deletedBy: user.username });
    });

    // ── Delete Message (Admin or sender) ──────────────────────
    socket.on('delete_message', data => {
        const user = users[socket.id];
        if (!user) return;
        const { messageId, roomId, targetType, targetId } = data;

        if (targetType === 'room' && rooms[roomId]) {
            if (roomMessages[roomId]) roomMessages[roomId] = roomMessages[roomId].filter(m => m.id !== messageId);
            io.to(roomId).emit('message_deleted', { messageId, roomId, deletedBy: user.username });
        } else if (targetType === 'user') {
            io.to(targetId).emit('message_deleted', { messageId, deletedBy: user.username });
            socket.emit('message_deleted', { messageId, deletedBy: user.username });
        }
    });

    // ── WebRTC Voice Call Signaling ────────────────────────────
    socket.on('call_user',    data => { const c = users[socket.id]; const t = users[data.targetId]; if (c && t) io.to(data.targetId).emit('incoming_call', { callerId: socket.id, callerName: c.username, callerColor: c.color }); });
    socket.on('answer_call',  data => { if (users[data.callerId]) io.to(data.callerId).emit('call_accepted', { responderId: socket.id }); });
    socket.on('reject_call',  data => { io.to(data.callerId).emit('call_rejected', { responderId: socket.id }); });
    socket.on('end_call',     data => { if (data.targetId) io.to(data.targetId).emit('call_ended', { senderId: socket.id }); });
    socket.on('webrtc_signal',data => { if (data.targetId) io.to(data.targetId).emit('webrtc_signal', { senderId: socket.id, signal: data.signal }); });

    // ── Disconnect ─────────────────────────────────────────────
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (!user) return;
        Object.values(rooms).forEach(r => { r.members = r.members.filter(m => m !== socket.id); });
        delete users[socket.id];
        broadcastUserList();
        broadcastRoomList();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 KuiDi running → http://localhost:${PORT}`);
    
    // Auto keep-alive for Render Free Tier (pings every 13 mins to prevent 15m idle shutdown)
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
        const pingIntervalMs = 13 * 60 * 1000; // 13 minutes
        console.log(`[Keep-Alive] Configured for ${renderUrl} every 13 minutes`);
        setInterval(() => {
            const url = `${renderUrl}/health`;
            const requester = url.startsWith('https') ? require('https') : require('http');
            requester.get(url, (res) => {
                console.log(`[Keep-Alive] Pinged ${url} (status: ${res.statusCode})`);
            }).on('error', (err) => {
                console.warn(`[Keep-Alive] Ping error: ${err.message}`);
            });
        }, pingIntervalMs);
    }
});
