// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Supabase client
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE env vars");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Helper: get waiting users for subject+size (exclude clientId optionally)
async function getWaitingFor(subject, desiredSize, excludeClientId = null) {
  let q = supabase
    .from("members")
    .select("*")
    .eq("subject", subject)
    .eq("desired_size", desiredSize)
    .is("room_id", null)
    .order("joined_at", { ascending: true });

  if (excludeClientId) q = q.neq("client_id", excludeClientId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Health
app.get("/", (_req, res) => res.send("Cloud Study Group Finder server running"));

// Rebind endpoint: update waiting rows for this client to new socket id
app.post("/api/rebind-socket", async (req, res) => {
  const { clientId, newSocketId } = req.body || {};
  if (!clientId || !newSocketId) {
    return res.status(400).json({ error: "clientId and newSocketId required" });
  }

  try {
    console.log("🔁 Rebind socket:", { clientId, newSocketId });
    await supabase
      .from("members")
      .update({ socket_id: newSocketId })
      .eq("client_id", clientId)
      .is("room_id", null);

    return res.json({ status: "ok" });
  } catch (e) {
    console.error("rebind error:", e);
    return res.status(500).json({ error: "rebind failed" });
  }
});

// Join endpoint: save waiting user and try to match
app.post("/api/join", async (req, res) => {
  const { name, subject, desiredSize = 2, socketId, clientId } = req.body || {};
  console.log("➡️ /api/join", { name, subject, desiredSize, socketId, clientId });

  if (!name || !subject || !socketId || !clientId) {
    return res.status(400).json({ error: "name, subject, socketId and clientId required" });
  }

  try {
    // Try to find existing waiting row by clientId
    const { data: existing, error: existingErr } = await supabase
      .from("members")
      .select("*")
      .eq("client_id", clientId)
      .is("room_id", null)
      .maybeSingle();
    if (existingErr) throw existingErr;

    let me;
    if (existing) {
      // Update socket id and details if needed
      const { data: updated, error: updErr } = await supabase
        .from("members")
        .update({
          name,
          subject,
          desired_size: desiredSize,
          socket_id: socketId,
          availability_start: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (updErr) throw updErr;
      me = updated;
    } else {
      // Insert new waiting member with clientId
      const { data: inserted, error: insertErr } = await supabase
        .from("members")
        .insert([{
          name,
          subject,
          desired_size: desiredSize,
          socket_id: socketId,
          client_id: clientId,
          availability_start: new Date().toISOString(),
        }])
        .select()
        .single();
      if (insertErr) throw insertErr;
      me = inserted;
    }

    // Find other waiting users (exclude same clientId)
    const others = await getWaitingFor(subject, desiredSize, clientId);

    if (others.length + 1 >= desiredSize) {
      const usersToMatch = [me, ...others.slice(0, desiredSize - 1)];

      // Create room
      const { data: room, error: roomErr } = await supabase
        .from("rooms")
        .insert([{ subject, status: "active" }])
        .select()
        .single();
      if (roomErr) throw roomErr;

      const memberIds = usersToMatch.map(u => u.id);
      const { error: updateErr } = await supabase
        .from("members")
        .update({ room_id: room.id })
        .in("id", memberIds);
      if (updateErr) throw updateErr;

      const participants = usersToMatch.map(u => ({
        id: u.id,
        name: u.name,
        socketId: u.socket_id,
        clientId: u.client_id || null
      }));

      // Debug log
      console.log("🎯 Matched users -> room:", room.id, participants);

      // Emit matched & roomData to all participants (if socket present)
      for (const u of usersToMatch) {
        const sid = u.socket_id;
        if (sid && io.sockets.sockets.get(sid)) {
          io.to(sid).emit("matched", { status: "matched", roomId: room.id, participants });
          io.to(sid).emit("roomData", { roomId: room.id, participants });
          console.log("📨 Emitted matched to socket:", sid);
        } else {
          console.warn("⚠️ Socket not connected for participant (will rely on client rebind):", sid, u.client_id);
        }
      }

      return res.json({ status: "matched", roomId: room.id, participants });
    }

    // Not enough yet
    return res.json({ status: "waiting" });
  } catch (err) {
    console.error("Join error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fallback: get room data (used when someone opens room link directly)
app.get("/api/room/:roomId", async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();
    if (roomErr) throw roomErr;

    const { data: participants, error: partErr } = await supabase
      .from("members")
      .select("id,name,socket_id,client_id")
      .eq("room_id", roomId);
    if (partErr) throw partErr;

    return res.json({
      roomId: room.id,
      subject: room.subject,
      participants: (participants || []).map(p => ({ id: p.id, name: p.name, socketId: p.socket_id, clientId: p.client_id }))
    });
  } catch (err) {
    console.error("Get room error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Leave (only remove if waiting)
app.post("/api/leave", async (req, res) => {
  const { socketId } = req.body || {};
  if (!socketId) return res.status(400).json({ error: "socketId required" });

  try {
    await supabase.from("members").delete().eq("socket_id", socketId).is("room_id", null);
    return res.json({ status: "left" });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Socket.IO lifecycle & relaying signals + peer discovery
io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);

  socket.on("disconnect", async () => {
    console.log("🔌 Client disconnected:", socket.id);
    try {
      await supabase.from("members").delete().eq("socket_id", socket.id).is("room_id", null);
    } catch (e) {
      console.error("Cleanup error:", e.message || e);
    }
  });

  socket.on("signal", ({ to, data }) => {
    if (to && data) io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("join-room", ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    console.log(`➡️ ${socket.id} joined room ${roomId}`);

    // Notify others and let newcomer know peers
    socket.to(roomId).emit("user-joined", { socketId: socket.id });

    const peers = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id);
    for (const peerId of peers) {
      socket.emit("user-joined", { socketId: peerId });
    }

    // Also send roomData to this socket
    io.to(socket.id).emit("roomData", { roomId });
  });

  socket.on("leave-room", ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    socket.to(roomId).emit("user-left", { socketId: socket.id });
    console.log(`⬅️ ${socket.id} left room ${roomId}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
