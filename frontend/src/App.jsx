// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Join from "./pages/Join";
import Room from "./pages/Room";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import { io } from "socket.io-client";

const SERVER = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  const [socket, setSocket] = useState(null);
  const [roomData, setRoomData] = useState(null);

  // Create socket only when user is logged in
  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.close();
        setSocket(null);
      }
      return;
    }

    // Create a new socket instance
    const s = io(SERVER, {
      transports: ["websocket"],        // force websockets in dev
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10000,
    });

    setSocket(s);

    // Useful diagnostics
    const onConnect = () => console.log("✅ Socket connected:", s.id);
    const onConnectError = (err) =>
      console.error("❌ Socket connect_error:", err?.message || err);
    const onDisconnect = (reason) =>
      console.warn("⚠️ Socket disconnected:", reason);

    const onRoomData = (data) => setRoomData(data);

    s.on("connect", onConnect);
    s.on("connect_error", onConnectError);
    s.on("disconnect", onDisconnect);
    s.on("roomData", onRoomData);

    return () => {
      s.off("connect", onConnect);
      s.off("connect_error", onConnectError);
      s.off("disconnect", onDisconnect);
      s.off("roomData", onRoomData);
      s.close();
    };
  }, [user]);

  // Loading auth state
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Auth guard
  if (
    !user &&
    !["/login", "/signup", "/forgot-password"].includes(location.pathname)
  ) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="app">
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/join" replace />}
        />
        <Route
          path="/signup"
          element={!user ? <Signup /> : <Navigate to="/join" replace />}
        />
        <Route
          path="/join"
          element={
            user ? (
              socket ? (
                <Join socket={socket} />
              ) : (
                <div className="loading-container">
                  <div className="loading-spinner"></div>
                  <p>Connecting to server...</p>
                </div>
              )
            ) : (
              <Navigate to="/login" state={{ from: "/join" }} replace />
            )
          }
        />
        <Route
          path="/room/:roomId"
          element={
            user ? (
              socket ? (
                <Room
                  socket={socket}
                  roomData={roomData}
                  onLeave={() => setRoomData(null)}
                />
              ) : (
                <div className="loading-container">
                  <div className="loading-spinner"></div>
                  <p>Loading room data...</p>
                </div>
              )
            ) : (
              <Navigate to="/login" state={{ from: location.pathname }} replace />
            )
          }
        />
        <Route
          path="/"
          element={<Navigate to={user ? "/join" : "/login"} replace />}
        />
      </Routes>
    </div>
  );
}
