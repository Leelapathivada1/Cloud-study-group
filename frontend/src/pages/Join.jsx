// src/pages/Join.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Join({ socket }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [desiredSize, setDesiredSize] = useState(2);
  const [status, setStatus] = useState("");
  const [socketReady, setSocketReady] = useState(false);
  const navigate = useNavigate();

  // persistent client id to identify this user across reconnects
  const [clientId] = useState(() => {
    try {
      const existing = sessionStorage.getItem("clientId");
      if (existing) return existing;
      const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `cid_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
      sessionStorage.setItem("clientId", id);
      return id;
    } catch {
      const id = `cid_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
      sessionStorage.setItem("clientId", id);
      return id;
    }
  });

  useEffect(() => {
    if (!socket) return;
    const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3000";

    const handleConnect = async () => {
      console.log("✅ Socket ready:", socket.id, "clientId:", clientId);
      setSocketReady(true);

      // tell server to rebind any waiting rows that belong to this clientId
      try {
        await fetch(`${apiBase}/api/rebind-socket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, newSocketId: socket.id }),
        });
      } catch (e) {
        console.warn("rebind failed", e);
      }
    };

    const handleDisconnect = () => {
      console.warn("⚠️ Socket lost");
      setSocketReady(false);
    };

    const handleMatched = (data) => {
      console.log("🎉 Matched event received:", data);
      navigate(`/room/${data.roomId}`);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("matched", handleMatched);

    // If already connected, run handler now
    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("matched", handleMatched);
    };
  }, [socket, clientId, navigate]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!name || !subject) return alert("Please enter your name and subject");
    if (!socket || !socket.id) return alert("Socket not connected yet. Please wait a moment.");

    setStatus("Finding study partners...");

    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3000";
      const res = await fetch(`${apiBase}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject,
          desiredSize: Number(desiredSize),
          socketId: socket.id,
          clientId
        }),
      });
      const data = await res.json();

      if (data.error) {
        console.error("Join error:", data.error);
        setStatus(`Error: ${data.error}`);
        return;
      }

      if (data.status === "matched" && data.roomId) {
        // immediate match
        navigate(`/room/${data.roomId}`);
      } else {
        // waiting; matched event will come later
        setStatus("Waiting for more students to join...");
      }
    } catch (err) {
      console.error("Error joining:", err);
      setStatus("Error connecting to server");
    }
  };

  return (
    <div className="join">
      <h1>Cloud Study Group Finder</h1>
      <form onSubmit={handleJoin}>
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Subject (e.g., Algorithms)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
        <div className="form-group">
          <label>Group size:</label>
          <select value={desiredSize} onChange={(e) => setDesiredSize(Number(e.target.value))}>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        <button type="submit" className="btn-primary" disabled={!socketReady || status === "waiting"}>
          {!socketReady ? "Connecting to server..." : status === "waiting" ? "Waiting for more students..." : "Find Study Partners"}
        </button>
      </form>

      {status && <p className="status">{status}</p>}
    </div>
  );
}
