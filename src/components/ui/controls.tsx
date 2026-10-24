"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/client/utils";

type ButtonVariant = "primary" | "ghost" | "outline" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "xs" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-strong shadow-sm",
  ghost: "text-ink-soft hover:bg-surface-2 hover:text-ink",
  outline: "border border-line-strong bg-surface text-ink hover:border-accent hover:text-accent-strong",
  danger: "text-danger hover:bg-danger-soft",
  subtle: "bg-surface-2 text-ink hover:bg-line",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-sm",
  xs: "h-7 px-2.5 text-xs",
  icon: "h-8 w-8",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink",
          "placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink",
          "placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({ label, children, hint }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
