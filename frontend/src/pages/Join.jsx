import React, { useState } from 'react';

export default function Join({ socket }) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [desiredSize, setDesiredSize] = useState(2);
  const [status, setStatus] = useState(null);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!name || !subject) return alert('Enter name and subject');

    const body = { 
      name, 
      subject, 
      desiredSize, 
      socketId: socket.id,
      email: `test-${Date.now()}@example.com` // Add a unique email for testing
    };
    
    setStatus('joining...');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      setStatus(JSON.stringify(json));
    } catch (err) {
      setStatus('error: ' + err.message);
    }
  };

  return (
    <div className="join">
      <h1>Cloud Study Group Finder</h1>
      <form onSubmit={handleJoin}>
        <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="Subject (e.g. Algorithms)" value={subject} onChange={e => setSubject(e.target.value)} />
        <label>
          Group size:
          <select value={desiredSize} onChange={e => setDesiredSize(Number(e.target.value))}>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <button type="submit">Find Partners</button>
      </form>
      {status && <p className="status">{status}</p>}
      <p className="hint">When matched you'll be placed into a browser video room.</p>
    </div>
  );
}
