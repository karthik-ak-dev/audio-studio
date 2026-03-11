import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SessionProvider } from "@/context/SessionContext";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { CreateSession } from "@/pages/CreateSession";
import { JoinSession } from "@/pages/JoinSession";
import { AudioRoom } from "@/pages/AudioRoom";
import { SessionComplete } from "@/pages/SessionComplete";

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <div className="flex flex-col">
          <Navbar />
          <div className="min-h-screen">
            <Routes>
              <Route path="/" element={<CreateSession />} />
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
