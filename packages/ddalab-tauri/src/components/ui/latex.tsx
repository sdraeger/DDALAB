/**
 * KaTeX LaTeX rendering component
 * Renders beautiful mathematical notation using KaTeX
 */

'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface LatexProps {
  children: string;
  block?: boolean;
  className?: string;
}

/**
 * LaTeX renderer using KaTeX
 */
export const Latex: React.FC<LatexProps> = ({ children, block = false, className = '' }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(children, {
        displayMode: block,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
      });
    } catch (error) {
      console.error('KaTeX rendering error:', error);
      // Fallback to plain text if rendering fails
      return children;
    }
  }, [children, block]);

  const Component = block ? 'div' : 'span';

  return (
    <Component
      className={`latex-content ${block ? 'latex-block' : 'latex-inline'} ${className}`}
      style={{
        fontSize: block ? '1.15em' : 'inherit',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/**
 * Block LaTeX component
 */
export const LatexBlock: React.FC<{ children: string; className?: string }> = ({
  children,
  className
}) => (
  <Latex block={true} className={className}>
    {children}
  </Latex>
);
