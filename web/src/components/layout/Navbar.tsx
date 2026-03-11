import { Link } from "react-router-dom";

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-elevated">
      <nav className="mx-auto flex max-w-container items-center justify-between px-5 py-3.5 md:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shadow-glow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <span className="text-lg font-black tracking-tight text-text">
            AUDIO<span className="text-accent">STUDIO</span>
          </span>
        </Link>

{/* Right side intentionally empty for clean header */}
        <div />
      </nav>
    </header>
  );
}
