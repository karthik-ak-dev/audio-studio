import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider } from "@/context/SessionContext";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Landing, getStoredEmail } from "@/pages/Landing";
import { Dashboard } from "@/pages/Dashboard";
import { CreateRecording } from "@/pages/CreateRecording";
import { CreateSession } from "@/pages/CreateSession";
import { JoinSession } from "@/pages/JoinSession";
import { AudioRoom } from "@/pages/AudioRoom";
import { SessionComplete } from "@/pages/SessionComplete";

/** Redirect to /dashboard if user has stored identity, otherwise show Landing. */
function LandingOrDashboard() {
  const email = getStoredEmail();
  if (email) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <div className="flex flex-col">
          <Navbar />
          <div className="min-h-screen">
            <Routes>
              <Route path="/" element={<LandingOrDashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/recordings/new" element={<CreateRecording />} />
              <Route path="/session/new" element={<CreateSession />} />
              <Route path="/join/:sessionId" element={<JoinSession />} />
              <Route path="/session/:sessionId" element={<AudioRoom />} />
              <Route path="/session/:sessionId/complete" element={<SessionComplete />} />
            </Routes>
          </div>
          <Footer />
        </div>
      </SessionProvider>
    </BrowserRouter>
  );
}
