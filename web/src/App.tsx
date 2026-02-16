/**
 * App.tsx — Root component and route definitions for Audio Studio.
 *
 * Route structure mirrors the user journey through the recording flow:
 *
 *   /                          → Home: create or join a meeting session
 *   /room/:roomId/green-room   → GreenRoom: mic check + device selection before recording
 *   /room/:roomId              → Studio: live recording session with peer via WebRTC
 *   /room/:roomId/results      → Results: view recordings, quality profile, and download files
 *
 * All routes are wrapped in an ErrorBoundary so that a React crash in any
 * page renders a friendly fallback with a "Refresh Page" button instead of
 * a blank white screen.
 *
 * Note: There is no auth-gate on routes — the server's join-room handler
 * enforces capacity (max 2 participants) and duplicate-session logic.
 */

import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import GreenRoom from './pages/GreenRoom';
import Studio from './pages/Studio';
import Results from './pages/Results';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <div className="min-h-screen">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId/green-room" element={<GreenRoom />} />
          <Route path="/room/:roomId" element={<Studio />} />
          <Route path="/room/:roomId/results" element={<Results />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
