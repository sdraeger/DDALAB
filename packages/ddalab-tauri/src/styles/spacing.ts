/**
 * Spacing constants and guidelines for consistent UI.
 *
 * This file documents the standard spacing values used throughout
 * the application to maintain visual consistency.
 *
 * Use these constants when creating new components or reviewing
 * existing ones for consistency.
 */

/**
 * Standard spacing scale (Tailwind classes)
 *
 * Extra Small (xs):  space-1, gap-1, p-1, m-1   (4px)
 * Small (sm):        space-2, gap-2, p-2, m-2   (8px)
 * Medium (md):       space-3, gap-3, p-3, m-3   (12px)
 * Default:           space-4, gap-4, p-4, m-4   (16px)
 * Large (lg):        space-6, gap-6, p-6, m-6   (24px)
 * Extra Large (xl):  space-8, gap-8, p-8, m-8   (32px)
 */

// Component-specific spacing guidelines
export const SPACING = {
  // Card components
  card: {
    padding: "p-4", // Standard card padding
    headerGap: "pb-3", // CardHeader bottom padding
    contentGap: "space-y-4", // Gap between content sections
  },

  // Form elements
  form: {
    fieldGap: "space-y-4", // Gap between form fields
    labelGap: "mb-2", // Gap between label and input
    helpTextGap: "mt-1", // Gap between input and help text
    buttonGap: "gap-2", // Gap between action buttons
  },

  // Lists and grids
  list: {
    itemGap: "space-y-2", // Gap between list items
    gridGap: "gap-4", // Gap in grid layouts
    compactGap: "gap-2", // Gap for compact lists
  },

  // Toolbar and navigation
  toolbar: {
    itemGap: "gap-2", // Gap between toolbar items
    sectionGap: "gap-4", // Gap between toolbar sections
    padding: "px-4 py-2", // Standard toolbar padding
  },

  // Modal/Dialog
  dialog: {
    padding: "p-6", // Dialog content padding
    sectionGap: "space-y-4", // Gap between dialog sections
    footerGap: "gap-2", // Gap between footer buttons
  },

  // Inline elements
  inline: {
    iconGap: "gap-1.5", // Gap between icon and text
    badgeGap: "gap-1", // Gap between inline badges
    buttonIconGap: "mr-2", // Gap between button icon and text
  },
} as const;

/**
 * Consistent class patterns for common UI elements
 */
export const SPACING_PATTERNS = {
  // Flex row with items centered and gap
  flexRow: "flex items-center gap-2",

  // Flex column with standard gap
  flexCol: "flex flex-col space-y-4",

  // Grid with responsive columns
  grid: "grid gap-4",

  // Section with padding and bottom border
  section: "p-4 border-b",

  // Compact inline list
  inlineList: "flex items-center gap-1.5",
} as const;
