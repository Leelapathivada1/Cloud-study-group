import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Join from './pages/Join';
import Room from './pages/Room';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function App() {
  const { user, loading } = useAuth();
  const [socket, setSocket] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const location = useLocation();

  useEffect(() => {
    if (user && !socket) {
      const newSocket = io(SERVER);
      setSocket(newSocket);

      newSocket.on('roomData', (data) => {
        setRoomData(data);
      });

      return () => {
        newSocket.close();
      };
    }
  }, [user, socket]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // If user is not authenticated and not on auth pages, redirect to login
  if (!user && !['/login', '/signup', '/forgot-password'].includes(location.pathname)) {
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
              <Navigate to="/login" state={{ from: '/join' }} replace />
            )
          } 
        />
        <Route 
          path="/room/:roomId" 
          element={
            user ? (
              socket && roomData ? (
                <Room socket={socket} roomData={roomData} onLeave={() => setRoomData(null)} />
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
          element={
            <Navigate to={user ? "/join" : "/login"} replace />
          } 
        />
      </Routes>
    </div>
  );
}
