import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

export default function Room() {
  const { roomId } = useParams();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function setupMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // For now: simulate remote video by reusing local stream
        // Later: replace with WebRTC peer connection
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing media devices.", err);
      }
    }

    setupMedia();
  }, []);

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room">
      {/* LEFT SIDE: Meeting Area */}
      <div className="video-container">
        <div className="header-container">
          <h1 className="main-heading">Your Meeting Room</h1>
          <p className="sub-heading">Discuss, collaborate, and connect instantly</p>
        </div>

        <div className="videos">
          <div className="local">
            <video ref={localVideoRef} autoPlay playsInline muted />
            <div className="label">You</div>
          </div>

          <div className="remote">
            <video ref={remoteVideoRef} autoPlay playsInline />
            <div className="label">Partner</div>
          </div>
        </div>

        {/* Room Actions */}
        <div className="room-actions">
          <div className="room-id-container">
            <span className="room-id-label">Room ID:</span>
            <button
              onClick={copyRoomId}
              className={`room-id-button ${copied ? "copied" : ""}`}
            >
              {roomId}
              <span className="copy-icon">{copied ? "✔" : "📋"}</span>
            </button>
          </div>

          <button className="join-button">Leave Meeting</button>
        </div>
      </div>

      {/* RIGHT SIDE: Sidebar with Image & Quote */}
      <div className="image-sidebar">
        <div className="room-image">
          <img src="/meeting.jpg" alt="Meeting illustration" />
        </div>

        <div className="quote-box">
          <p className="quote">
            Great meetings don’t happen by chance, they happen by design.
          </p>
          <p className="quote-author">— Google Meet Inspired</p>
        </div>
      </div>
    </div>
  );
}
