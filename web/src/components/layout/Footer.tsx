export function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-container flex-wrap items-center justify-center gap-4 px-5 md:gap-8 md:px-8">
        <span className="text-[11px] text-text-muted md:text-[13px]">
          &copy; {new Date().getFullYear()} AudioStudio
        </span>
      </div>
    </footer>
  );
}
