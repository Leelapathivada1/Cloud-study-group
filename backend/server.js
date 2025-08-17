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
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// ──────────────────────────────────────────────
// Supabase
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
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Keep a lightweight in-memory index for fast matching (optional).
let waitingCache = new Map(); // socketId -> { id, name, subject, desired_size, socket_id, joined_at }

// Helper: get a queue of waiting users (from DB) for a given subject+size
async function getWaitingFor(subject, desiredSize, excludeSocketId = null) {
  const query = supabase
    .from("members")
    .select("*")
    .eq("subject", subject)
    .eq("desired_size", desiredSize)
    .is("room_id", null)
    .order("joined_at", { ascending: true });

  const { data, error } = excludeSocketId
    ? await query.neq("socket_id", excludeSocketId)
    : await query;

  if (error) throw error;
  return data || [];
}

// ──────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Cloud Study Group Finder server running"));
// ──────────────────────────────────────────────

// JOIN endpoint: Add user to waiting queue and try to match
app.post("/api/join", async (req, res) => {
  const { name, subject, desiredSize = 2, socketId } = req.body;
  console.log("➡️  /api/join", { name, subject, desiredSize, socketId });

  if (!name || !subject || !socketId) {
    return res
      .status(400)
      .json({ error: "name, subject and socketId required" });
  }

  try {
    // If already waiting (room_id null), just return waiting
    const { data: existing, error: existingErr } = await supabase
      .from("members")
      .select("*")
      .eq("socket_id", socketId)
      .is("room_id", null)
      .maybeSingle();

    if (existingErr) throw existingErr;

    let me = existing;
    if (!me) {
      // Insert as waiting
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

    // Cache for quick lookups (optional)
    waitingCache.set(socketId, me);

    // Check for potential matches
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
      const memberIds = usersToMatch.map((u) => u.id);
      const { error: updateErr } = await supabase
        .from("members")
        .update({ room_id: room.id })
        .in("id", memberIds);
      if (updateErr) throw updateErr;

      // Prepare payload and notify each participant
      const participants = usersToMatch.map((u) => ({
        id: u.id,
        name: u.name,
        socketId: u.socket_id,
      }));

      usersToMatch.forEach((u) => {
        // Remove from cache (not waiting anymore)
        waitingCache.delete(u.socket_id);
        io.to(u.socket_id).emit("matched", { roomId: room.id, participants });
      });

      return res.json({ status: "matched", roomId: room.id, participants });
    }

    // Not enough to match yet
    return res.json({ status: "waiting" });
  } catch (err) {
    console.error("Join error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Optional: list rooms for debugging
app.get("/api/rooms", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Optional: list waiting members (room_id null)
app.get("/api/waiting", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .is("room_id", null)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Optional: leave (remove member entirely)
app.post("/api/leave", async (req, res) => {
  const { socketId } = req.body;
  if (!socketId)
    return res.status(400).json({ error: "socketId required" });
  try {
    await supabase.from("members").delete().eq("socket_id", socketId);
    waitingCache.delete(socketId);
    res.json({ status: "left" });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Socket.IO lifecycle
io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);

  socket.on("disconnect", async () => {
    console.log("🔌 Client disconnected:", socket.id);
    // Remove only if still waiting (room_id is null)
    try {
      await supabase
        .from("members")
        .delete()
        .eq("socket_id", socket.id)
        .is("room_id", null);
      waitingCache.delete(socket.id);
    } catch (e) {
      console.error("Cleanup error:", e.message || e);
    }
  });

  // WebRTC relay (if you use it in Room.jsx)
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("join-room", ({ roomId }) => {
    if (roomId) {
      socket.join(roomId);
      console.log(`➡️  ${socket.id} joined room ${roomId}`);
      // Optional room data push:
      io.to(socket.id).emit("roomData", { roomId });
    }
  });

  socket.on("leave-room", ({ roomId }) => {
    if (roomId) {
      socket.leave(roomId);
      console.log(`⬅️  ${socket.id} left room ${roomId}`);
    }
  });
});

// ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
