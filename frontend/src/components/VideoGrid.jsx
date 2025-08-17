import React from 'react';

export default function VideoGrid({ remoteStreams = {}, participants = [] }) {
  return (
    <div className="remote-grid">
      {Object.entries(remoteStreams).map(([socketId, stream]) => {
        return <RemoteVideo key={socketId} stream={stream} socketId={socketId} participants={participants} />;
      })}
    </div>
  );
}

function RemoteVideo({ stream, socketId, participants }) {
  const ref = React.useRef();
  React.useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const name = (participants.find(p => p.socketId === socketId) || {}).name || socketId;
  return (
    <div className="remote">
      <video ref={ref} autoPlay playsInline />
      <div className="label">{name}</div>
    </div>
  );
}
