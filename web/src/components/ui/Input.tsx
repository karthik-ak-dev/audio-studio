import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full rounded-md px-4 py-3
            bg-white/[0.04] border border-border
            text-text placeholder:text-text-muted/50
            outline-none transition-all duration-200
            focus:border-accent/50 focus:ring-1 focus:ring-accent/20
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20" : ""}
            ${className}
          `}
          {...props}
        />
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
