"use client";

import React from "react";
import { Check } from "lucide-react";

export interface WizardStepProps {
  number: number;
  title: string;
  description?: string;
  isActive: boolean;
  isCompleted: boolean;
  onClick?: () => void;
  className?: string;
}

export const WizardStep: React.FC<WizardStepProps> = ({
  number,
  title,
  description,
  isActive,
  isCompleted,
  onClick,
  className = "",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`
        flex items-center gap-3 p-3 rounded-lg transition-all
        ${isActive ? "bg-primary/10 border-2 border-primary" : "border-2 border-transparent"}
        ${isCompleted && !isActive ? "bg-muted/50" : ""}
        ${onClick ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}
        ${className}
      `}
      aria-current={isActive ? "step" : undefined}
    >
      <div
        className={`
          flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 font-semibold
          ${isActive ? "bg-primary text-primary-foreground" : ""}
          ${isCompleted && !isActive ? "bg-green-500 text-white" : ""}
          ${!isActive && !isCompleted ? "bg-muted text-muted-foreground" : ""}
        `}
      >
        {isCompleted ? <Check className="h-5 w-5" /> : number}
      </div>

      <div className="flex-1 text-left">
        <p className={`font-medium ${isActive ? "text-primary" : ""}`}>
          {title}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
    </button>
  );
};
