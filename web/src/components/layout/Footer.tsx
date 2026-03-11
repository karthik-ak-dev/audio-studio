export function Footer() {
  return (
    <footer className="border-t border-border py-6">
      <div className="mx-auto flex max-w-container items-center justify-center px-5 md:px-8">
        <span className="text-[11px] text-text-muted/60">
          &copy; {new Date().getFullYear()} AudioStudio
        </span>
      </div>
    </footer>
  );
}
