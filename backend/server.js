require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
}));

// Supabase server client (service_role key)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// In-memory quick mapping socketId -> member id
const socketToMember = new Map();

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  }
});

// Health
app.get('/', (req, res) => res.send('Cloud Study Group Finder server running'));

/**
 * POST /api/join
 * body: { name, subject, desiredSize (int), socketId, email }
 */
app.post('/api/join', async (req, res) => {
  const { name, subject, desiredSize = 2, socketId, email } = req.body;
  if (!name || !subject || !socketId) return res.status(400).json({ error: 'name, subject and socketId required' });

  try {
    // First, check if this socket is already in a room
    const existingMember = await supabase
      .from('members')
      .select('*')
      .eq('socket_id', socketId)
      .maybeSingle();

    if (existingMember.data) {
      // If already in a room, return that room
      if (existingMember.data.room_id) {
        const room = await supabase
          .from('rooms')
          .select('*')
          .eq('id', existingMember.data.room_id)
          .single();
          
        if (room.data) {
          const members = await supabase
            .from('members')
            .select('*')
            .eq('room_id', existingMember.data.room_id);
            
          io.to(socketId).emit('matched', {
            roomId: room.data.id,
            participants: members.data.map(m => ({
              id: m.id,
              name: m.name,
              socketId: m.socket_id
            }))
          });
          
          return res.json({ status: 'matched', roomId: room.data.id });
        }
      }
      
      // If not in a room but exists, delete the old entry
      await supabase
        .from('members')
        .delete()
        .eq('socket_id', socketId);
    }

    // Insert new member
    const insertResp = await supabase
      .from('members')
      .insert([{
        name,
        email,
        subject,
        desired_size: desiredSize,
        socket_id: socketId
      }])
      .select()
      .single();

    if (insertResp.error) throw insertResp.error;
    const member = insertResp.data;
    socketToMember.set(socketId, member.id);

    // Find waiting members for this subject
    const waitingResp = await supabase
      .from('members')
      .select('*')
      .eq('subject', subject)
      .is('room_id', null)
      .order('joined_at', { ascending: true });

    if (waitingResp.error) throw waitingResp.error;
    
    // Get the first 'desiredSize' members, including the current user if needed
    const waiting = waitingResp.data;
    const potentialMatches = waiting.filter(m => m.id !== member.id).slice(0, desiredSize - 1);
    
    // If we have enough members (including the current one), create a room
    if (potentialMatches.length + 1 >= desiredSize) {
      const membersToMatch = [member, ...potentialMatches];
      
      // Create room
      const roomResp = await supabase
        .from('rooms')
        .insert([{ subject }])
        .select()
        .single();
        
      if (roomResp.error) throw roomResp.error;
      const room = roomResp.data;

      // Update all matched members with the room ID
      const memberIds = membersToMatch.map(m => m.id);
      const updResp = await supabase
        .from('members')
        .update({ room_id: room.id })
        .in('id', memberIds)
        .select();

      if (updResp.error) throw updResp.error;
      const updatedMembers = updResp.data;

      // Notify all matched members
      for (const m of updatedMembers) {
        if (m.socket_id) {
          io.to(m.socket_id).emit('matched', {
            roomId: room.id,
            participants: updatedMembers.map(mm => ({
              id: mm.id,
              name: mm.name,
              socketId: mm.socket_id
            }))
          });
        }
      }

      return res.json({ status: 'matched', roomId: room.id });
    }

    return res.json({ status: 'waiting' });

  } catch (err) {
    console.error('join error', err);
    return res.status(500).json({ error: err.message || err });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || err });
  }
});

app.post('/api/leave', async (req, res) => {
  const { socketId } = req.body;
  if (!socketId) return res.status(400).json({ error: 'socketId required' });
  try {
    await supabase.from('members').delete().eq('socket_id', socketId);
    socketToMember.delete(socketId);
    res.json({ status: 'left' });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

/* Socket.io signalling */
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('signal', (payload) => {
    const { to, data } = payload;
    if (!to || !data) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('join-room', ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.to(roomId).emit('peer-joined', { socketId: socket.id });
  });

  socket.on('leave-room', ({ roomId }) => {
    if (roomId) socket.leave(roomId);
  });

  socket.on('disconnect', async () => {
    console.log('socket disconnected', socket.id);
    try {
      await supabase.from('members').delete().eq('socket_id', socket.id);
    } catch (err) {
      console.warn('cleanup error', err);
    }
    socketToMember.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
