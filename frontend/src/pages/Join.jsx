// src/pages/Join.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Join({ socket }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [desiredSize, setDesiredSize] = useState(2);
  const [status, setStatus] = useState("");
  const [socketReady, setSocketReady] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      console.log("✅ Socket ready:", socket.id);
      setSocketReady(true);
    };
    const handleDisconnect = () => {
      console.warn("⚠️ Socket lost");
      setSocketReady(false);
    };
    const handleMatched = (data) => {
      console.log("🎉 Matched:", data);
      navigate(`/room/${data.roomId}`);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("matched", handleMatched);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("matched", handleMatched);
    };
  }, [socket, navigate]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!name || !subject) {
      alert("Please enter your name and subject");
      return;
    }
    if (!socket || !socket.id) {
      alert("Socket not connected yet. Please wait a moment.");
      return;
    }

    setStatus("Finding study partners...");

    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3000";
      const response = await fetch(`${apiBase}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject,
          desiredSize,
          socketId: socket.id,
        }),
      });

      const data = await response.json();

      if (data.error) {
        console.error("Join error:", data.error);
        setStatus(`Error: ${data.error}`);
        return;
      }

      if (data.status === "matched") {
        navigate(`/room/${data.roomId}`);
      } else if (data.status === "waiting") {
        setStatus("Waiting for more students to join...");
      } else {
        setStatus("");
      }
    } catch (err) {
      console.error("Error connecting:", err);
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
          <select
            value={desiredSize}
            onChange={(e) => setDesiredSize(Number(e.target.value))}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={!socketReady || status === "waiting"}
        >
          {!socketReady
            ? "Connecting to server..."
            : status === "waiting"
            ? "Waiting for more students..."
            : "Find Study Partners"}
        </button>
      </form>
      {status && <p className="status">{status}</p>}
    </div>
  );
}
