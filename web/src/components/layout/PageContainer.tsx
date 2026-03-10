import { type ReactNode } from "react";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <main
      className={`
        mx-auto w-full max-w-container
        px-5 pt-24 pb-16
        md:px-8 md:pt-32 md:pb-24
        ${className}
      `}
    >
      {children}
    </main>
  );
}
