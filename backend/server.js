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

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// ──────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ──────────────────────────────────────────────
// Socket.IO
// ──────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Small helper: get waiting users for subject+size
async function getWaitingFor(subject, desiredSize, excludeSocketId = null) {
  let q = supabase
    .from("members")
    .select("*")
    .eq("subject", subject)
    .eq("desired_size", desiredSize)
    .is("room_id", null)
    .order("joined_at", { ascending: true });

  if (excludeSocketId) q = q.neq("socket_id", excludeSocketId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Health
app.get("/", (_req, res) => res.send("Cloud Study Group Finder server running"));

// ──────────────────────────────────────────────
// Rebind stale socket IDs for waiting users
// ──────────────────────────────────────────────
app.post("/api/rebind-socket", async (req, res) => {
  const { previousSocketId, newSocketId } = req.body || {};
  if (!newSocketId) return res.status(400).json({ error: "newSocketId required" });

  try {
    if (previousSocketId && previousSocketId !== newSocketId) {
      // Update rows still waiting with old socket id
      await supabase
        .from("members")
        .update({ socket_id: newSocketId })
        .eq("socket_id", previousSocketId)
        .is("room_id", null);
    }
    return res.json({ status: "ok" });
  } catch (e) {
    console.error("rebind error:", e);
    return res.status(500).json({ error: "rebind failed" });
  }
});

// ──────────────────────────────────────────────
// Join queue, try to match
// ──────────────────────────────────────────────
app.post("/api/join", async (req, res) => {
  const { name, subject, desiredSize = 2, socketId } = req.body;
  console.log("➡️  /api/join", { name, subject, desiredSize, socketId });

  if (!name || !subject || !socketId) {
    return res.status(400).json({ error: "name, subject and socketId required" });
  }

  try {
    // Upsert-like behavior: if a waiting row exists for this socket, reuse it
    const { data: existing, error: existingErr } = await supabase
      .from("members")
      .select("*")
      .eq("socket_id", socketId)
      .is("room_id", null)
      .maybeSingle();
    if (existingErr) throw existingErr;

    let me = existing;
    if (!me) {
      const { data: inserted, error: insertErr } = await supabase
        .from("members")
        .insert([
          {
            name,
            subject,
            desired_size: desiredSize,
            socket_id: socketId,
            availability_start: new Date().toISOString(),
          },
        ])
        .select()
        .single();
      if (insertErr) throw insertErr;
      me = inserted;
    }

    // Check for match
    const others = await getWaitingFor(subject, desiredSize, socketId);

    if (others.length + 1 >= desiredSize) {
      const usersToMatch = [me, ...others.slice(0, desiredSize - 1)];

      // Create room
      const { data: room, error: roomErr } = await supabase
        .from("rooms")
        .insert([{ subject, status: "active" }])
        .select()
        .single();
      if (roomErr) throw roomErr;

      // Assign room to members
      const ids = usersToMatch.map((u) => u.id);
      const { error: updErr } = await supabase
        .from("members")
        .update({ room_id: room.id })
        .in("id", ids);
      if (updErr) throw updErr;

      const participants = usersToMatch.map((u) => ({
        id: u.id,
        name: u.name,
        socketId: u.socket_id,
      }));
      const payload = { status: "matched", roomId: room.id, subject, participants };

      // Notify everyone by socket and also provide roomData
      for (const u of usersToMatch) {
        io.to(u.socket_id).emit("matched", payload);
        io.to(u.socket_id).emit("roomData", payload);
      }

      // Reply to caller as well
      return res.json(payload);
    }

    // Not enough yet
    return res.json({ status: "waiting" });
  } catch (err) {
    console.error("Join error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fallback: get room data (refresh support)
app.get("/api/room/:roomId", async (req, res) => {
  try {
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", req.params.roomId)
      .single();
    if (roomErr) throw roomErr;

    const { data: participants, error: partErr } = await supabase
      .from("members")
      .select("id,name,socket_id,subject,desired_size,joined_at,room_id")
      .eq("room_id", req.params.roomId);
    if (partErr) throw partErr;

    return res.json({
      roomId: room.id,
      subject: room.subject,
      participants: (participants || []).map((p) => ({
        id: p.id,
        name: p.name,
        socketId: p.socket_id,
      })),
    });
  } catch (err) {
    console.error("Get room error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Leave (remove only if still waiting)
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

// ──────────────────────────────────────────────
// Socket.IO lifecycle + peer discovery
// ──────────────────────────────────────────────
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

  // WebRTC relay
  socket.on("signal", ({ to, data }) => {
    if (to && data) io.to(to).emit("signal", { from: socket.id, data });
  });

  // Critical: announce peer presence both ways
  socket.on("join-room", ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    console.log(`➡️  ${socket.id} joined room ${roomId}`);

    // Notify others that this user joined
    socket.to(roomId).emit("user-joined", { socketId: socket.id });

    // Let the newcomer know who is already in the room
    const peers = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(
      (id) => id !== socket.id
    );
    for (const peerId of peers) {
      socket.emit("user-joined", { socketId: peerId });
    }

    // Optional: send minimal roomData
    io.to(socket.id).emit("roomData", { roomId });
  });

  socket.on("leave-room", ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    socket.to(roomId).emit("user-left", { socketId: socket.id });
    console.log(`⬅️  ${socket.id} left room ${roomId}`);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
