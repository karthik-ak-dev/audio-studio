import { type HTMLAttributes, type ReactNode } from "react";

type CardVariant = "default" | "elevated" | "accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}

const variantStyles: Record<CardVariant, string> = {
  default: "glass",
  elevated: "glass-elevated",
  accent: "bg-accent/[0.06] border border-accent/20",
};

export function Card({
  variant = "default",
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`
        rounded-lg p-4 md:p-6
        ${variantStyles[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}
