import { type ReactNode } from "react";

type BadgeVariant = "accent" | "warning" | "error" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  accent: "bg-accent/10 text-accent",
  warning: "bg-yellow-500/10 text-yellow-400",
  error: "bg-red-500/10 text-red-400",
  neutral: "bg-white/[0.06] text-text-muted",
};

export function Badge({
  variant = "accent",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center
        px-2 py-0.5 rounded
        text-[10px] font-bold uppercase tracking-wider
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
