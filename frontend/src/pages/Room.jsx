// src/pages/Room.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function Room({ socket, roomData, onLeave }) {
  const { roomId: roomIdFromParams } = useParams();
  const roomId = roomData?.roomId || roomIdFromParams;

  const localVideoRef = useRef();
  const [localStream, setLocalStream] = useState(null);
  const pcsRef = useRef({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [participants, setParticipants] = useState(roomData?.participants || []);
  const [isCopied, setIsCopied] = useState(false);

  // If refreshed: fetch participants
  useEffect(() => {
    if (roomData?.participants?.length) return;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/room/${roomId}`);
        const data = await res.json();
        if (!data.error && data.participants) {
          setParticipants(data.participants);
        }
      } catch {}
    })();
  }, [roomId, roomData]);

  // Start local media + join room
  useEffect(() => {
    if (!socket || !roomId) return;
    let stream;

    async function startLocal() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(e => console.error('Error playing local video:', e));
        }
      } catch (err) {
        console.error('Error accessing media devices:', err);
      }
    }

    startLocal();
    socket.emit('join-room', { roomId });

    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      socket.emit('leave-room', { roomId });
      socket.off('signal');
      socket.off('user-joined');
      socket.off('user-left');
    };
  }, [socket, roomId]);

  // Socket events: signaling & peer presence
  useEffect(() => {
    if (!socket) return;

    const onSignal = ({ from, data }) => handleSignal(from, data);
    const onUserJoined = ({ socketId }) => {
      setParticipants(prev => {
        if (prev.some(p => p.socketId === socketId)) return prev;
        return [...prev, { socketId }];
      });
    };
    const onUserLeft = ({ socketId }) => {
      setParticipants(prev => prev.filter(p => p.socketId !== socketId));
      if (pcsRef.current[socketId]) {
        pcsRef.current[socketId].close();
        delete pcsRef.current[socketId];
      }
      setRemoteStreams(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    };

    socket.on('signal', onSignal);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);

    return () => {
      socket.off('signal', onSignal);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
    };
  }, [socket, localStream]);

  // Create connections when participants change
  useEffect(() => {
    if (!localStream || !socket) return;
    for (const p of participants) {
      if (!p.socketId) continue;
      if (p.socketId === socket.id) continue;
      if (pcsRef.current[p.socketId]) continue;
      createPeerConnection(p.socketId, localStream);
    }
    // eslint-disable-next-line
  }, [participants, localStream, socket?.id]);

  async function createPeerConnection(remoteSocketId, localStream) {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (ev) => {
      setRemoteStreams(prev => {
        const existing = prev[remoteSocketId] || new MediaStream();
        ev.streams[0].getTracks().forEach(t => existing.addTrack(t));
        return { ...prev, [remoteSocketId]: existing };
      });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit('signal', { to: remoteSocketId, data: { type: 'ice', candidate: ev.candidate } });
      }
    };

    pcsRef.current[remoteSocketId] = pc;

    // Deterministic initiator by socket id
    const initiator = socket.id < remoteSocketId;

    if (initiator) {
      const dc = pc.createDataChannel('chat');
      dc.onopen = () => console.log('Data channel open to', remoteSocketId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: remoteSocketId, data: { type: 'offer', sdp: offer } });
    } else {
      pc.ondatachannel = (evt) => {
        const channel = evt.channel;
        channel.onmessage = (e) => console.log('msg', e.data);
      };
    }
  }

  async function handleSignal(from, data) {
    let pc = pcsRef.current[from];
    if (!pc) {
      if (!localStream) return;
      await createPeerConnection(from, localStream);
      pc = pcsRef.current[from];
    }

    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      socket.emit('signal', { to: from, data: { type: 'answer', sdp: ans } });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'ice') {
      try {
        if (data.candidate) await pc.addIceCandidate(data.candidate);
      } catch (err) {
        console.warn('ICE add err', err);
      }
    }
  }

  function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    Object.values(pcsRef.current).forEach(pc => pc.close && pc.close());
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socketId: socket.id })
    }).catch(() => {});
    onLeave && onLeave();
  }

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="room">
      <div className="video-container">
        <div className="header-container">
          <h1 className="main-heading">Video calls, meetings for everyone</h1>
          <p className="sub-heading">Connect, collaborate and celebrate anywhere with Cloud Study Group Finder</p>
        </div>

        <div className="videos">
          <div className="local">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
            />
            <div className="label">You</div>
          </div>

          {Object.entries(remoteStreams).map(([id, stream], index) => (
            <div key={id} className="remote">
              <video
                autoPlay
                playsInline
                ref={el => {
                  if (el && stream) {
                    el.srcObject = stream;
                    el.play().catch(e => console.error('Error playing remote video:', e));
                  }
                }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div className="label">Participant {index + 1}</div>
            </div>
          ))}
        </div>

        <div className="room-actions">
          <div className="room-id-container">
            <span className="room-id-label">Room ID:</span>
            <button
              className={`room-id-button ${isCopied ? 'copied' : ''}`}
              onClick={copyRoomId}
              title="Click to copy"
            >
              {roomId}
              <span className="copy-icon">{isCopied ? '✓' : '⎘'}</span>
            </button>
          </div>
          <button className="join-button" onClick={leaveRoom}>Leave Room</button>
        </div>
      </div>

      <div className="image-sidebar">
        <div className="room-image">
          <img src="/Project_2-08.jpg" alt="Collaborative Study" />
        </div>
        <div className="quote-box">
          <p className="quote">"Alone we can do so little; together we can do so much."</p>
          <p className="quote-author">- Helen Keller</p>
        </div>
      </div>
    </div>
  );
}
