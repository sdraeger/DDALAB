/**
 * KaTeX LaTeX rendering component
 * Renders beautiful mathematical notation using KaTeX
 *
 * Uses KaTeX's direct DOM rendering instead of dangerouslySetInnerHTML
 * to prevent XSS vulnerabilities
 */

"use client";

import React, { useRef, useEffect } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexProps {
  children: string;
  block?: boolean;
  className?: string;
}

/**
 * LaTeX renderer using KaTeX with secure DOM rendering
 *
 * This component uses katex.render() which renders directly to the DOM
 * instead of using dangerouslySetInnerHTML with renderToString(). This approach
 * is safer because KaTeX's DOM rendering doesn't involve parsing HTML strings.
 */
export const Latex: React.FC<LatexProps> = ({
  children,
  block = false,
  className = "",
}) => {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      // Clear previous content
      containerRef.current.innerHTML = "";

      try {
        // Use katex.render() for direct DOM manipulation
        // This is safer than renderToString() + dangerouslySetInnerHTML
        katex.render(children, containerRef.current, {
          displayMode: block,
          throwOnError: false,
          strict: false,
          trust: false, // Disable potentially dangerous features
          output: "html",
        });
      } catch (error) {
        console.error("KaTeX rendering error:", error);
        // Fallback to plain text if rendering fails (safely escaped)
        containerRef.current.textContent = children;
      }
    }
  }, [children, block]);

  const Component = block ? "div" : "span";

  return (
    <Component
      ref={containerRef as React.RefObject<HTMLDivElement & HTMLSpanElement>}
      className={`latex-content ${block ? "latex-block" : "latex-inline"} ${className}`}
      style={{
        fontSize: block ? "1.15em" : "inherit",
      }}
    />
  );
};

/**
 * Block LaTeX component
 */
export const LatexBlock: React.FC<{ children: string; className?: string }> = ({
  children,
  className,
}) => (
  <Latex block={true} className={className}>
    {children}
  </Latex>
);
