interface LoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeStyles: Record<string, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-3",
};

export function Loader({ size = "md", className = "" }: LoaderProps) {
  return (
    <div
      className={`
        animate-spin rounded-full
        border-accent/30 border-t-accent
        ${sizeStyles[size]}
        ${className}
      `}
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader size="lg" />
        <span className="text-sm text-text-muted tracking-wide">Loading...</span>
      </div>
    </div>
  );
}
