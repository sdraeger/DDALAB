/**
 * Collapsible configuration section wrapper
 * Provides a cleaner accordion-based UI for DDA configuration
 */

"use client";

import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { LucideIcon } from "lucide-react";

interface ConfigurationSectionProps {
  icon: LucideIcon;
  title: string;
  badge?: string | number;
  badgeVariant?: "default" | "secondary" | "outline" | "destructive";
  defaultOpen?: boolean;
  children: React.ReactNode;
  value: string;
}

export const ConfigurationSection: React.FC<ConfigurationSectionProps> = ({
  icon: Icon,
  title,
  badge,
  badgeVariant = "secondary",
  children,
  value,
}) => {
  return (
    <AccordionItem value={value} className="border rounded-lg px-4 bg-card">
      <AccordionTrigger className="hover:no-underline py-3">
        <div className="flex items-center gap-3 w-full">
          <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-semibold text-sm">{title}</span>
          {badge && (
            <Badge variant={badgeVariant} className="ml-auto mr-2 text-xs">
              {badge}
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-3 pb-2">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
};

interface ConfigurationAccordionProps {
  children: React.ReactNode;
  defaultOpen?: string[];
  className?: string;
}

export const ConfigurationAccordion: React.FC<ConfigurationAccordionProps> = ({
  children,
  defaultOpen = [],
  className = "",
}) => {
  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen}
      className={`space-y-3 ${className}`}
    >
      {children}
    </Accordion>
  );
};
