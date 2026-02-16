import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import GreenRoom from './pages/GreenRoom';
import Studio from './pages/Studio';
import Results from './pages/Results';

export default function App() {
  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId/green-room" element={<GreenRoom />} />
        <Route path="/room/:roomId" element={<Studio />} />
        <Route path="/room/:roomId/results" element={<Results />} />
      </Routes>
    </div>
  );
}
