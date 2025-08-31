# LlamB Extension Design System

> A clean, minimalist design system based on the chat sidebar's simple and professional aesthetic.

## Design Philosophy

The LlamB extension follows a **minimalist design philosophy** focused on:

- **Clarity over decoration** - Clean interfaces without unnecessary visual noise
- **Consistency** - Unified patterns across all views
- **Accessibility** - Clear hierarchy and sufficient contrast
- **Performance** - Lightweight styling with no heavy visual effects

### Core Principles

1. **No shadows** - Flat design with subtle borders for definition
2. **Neutral colors** - Black and white theme, no distracting accent colors  
3. **Generous spacing** - Comfortable padding and margins
4. **System fonts** - Native platform typography
5. **Subtle animations** - Smooth but unobtrusive transitions

## Color Palette

### Light Mode
```css
--llamb-bg-primary: #ffffff     /* Main backgrounds */
--llamb-bg-secondary: #ffffff   /* Card backgrounds */
--llamb-bg-tertiary: #f9f9f9    /* Input fields, subtle areas */
--llamb-text-primary: #0d0d0d   /* Main text */
--llamb-text-secondary: #8e8ea0 /* Secondary text, labels */
--llamb-text-tertiary: #c4c4c4  /* Placeholder text, disabled */
--llamb-border: #f0f0f0         /* Subtle borders */
--llamb-user-bubble: #2a2a2a    /* User messages, primary actions */
--llamb-assistant-bubble: #f6f6f6 /* AI messages */
```

### Dark Mode
```css
--llamb-bg-primary: #1a1a1a     /* Main backgrounds */
--llamb-bg-secondary: #1a1a1a   /* Card backgrounds */
--llamb-bg-tertiary: #2a2a2a    /* Input fields, subtle areas */
--llamb-text-primary: #ffffff   /* Main text */
--llamb-text-secondary: #8e8ea0 /* Secondary text, labels */
--llamb-text-tertiary: #666666  /* Placeholder text, disabled */
--llamb-border: #2a2a2a         /* Subtle borders */
--llamb-user-bubble: #2a2a2a    /* User messages, primary actions */
--llamb-assistant-bubble: #2a2a2a /* AI messages */
```

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### Font Sizes
- **11px** - Small labels, metadata
- **12px** - Chips, small buttons  
- **13px** - Secondary text, form inputs
- **14px** - Body text, default size
- **15px** - Section headers, prominent text
- **16px** - Page titles, main headings
- **18px** - Large headings, logos

### Font Weights
- **400 (Regular)** - Body text, default
- **500 (Medium)** - Emphasized text, button labels
- **600 (Semibold)** - Headers, important labels

## Spacing System

### Padding Scale
```css
padding: 8px   /* Compact spacing */
padding: 12px  /* Standard button/input padding */
padding: 16px  /* Section padding */
padding: 20px  /* Content area padding */
padding: 24px  /* Page/container padding */
```

### Gap Scale
```css
gap: 4px   /* Tight spacing (header actions) */
gap: 8px   /* Standard spacing (chips, small elements) */
gap: 10px  /* Medium spacing (title elements) */
gap: 12px  /* Comfortable spacing (input areas) */
```

## Border Radius

### Radius Scale
```css
border-radius: 4px   /* Small elements (icons, small buttons) */
border-radius: 6px   /* Medium buttons, containers */
border-radius: 8px   /* Cards, code blocks */
border-radius: 12px  /* Chips, action buttons */
border-radius: 16px  /* Message bubbles */
border-radius: 20px  /* Input fields */
border-radius: 50%   /* Circular buttons (send, theme toggle) */
```

## Component Patterns

### Headers
```css
.llamb-header {
  padding: 24px 24px 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--llamb-bg-primary);
}

.llamb-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}

.llamb-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
```

### Buttons
```css
.llamb-btn {
  background: var(--llamb-bg-tertiary);
  border: 1px solid var(--llamb-border);
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--llamb-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.llamb-btn:hover {
  background: var(--llamb-user-bubble);
  color: var(--llamb-user-text);
  border-color: var(--llamb-user-bubble);
}

.llamb-btn-primary {
  background: var(--llamb-user-bubble);
  color: var(--llamb-user-text);
  border-color: var(--llamb-user-bubble);
}
```

### Input Fields
```css
.llamb-input {
  background: var(--llamb-bg-tertiary);
  border: 1px solid var(--llamb-border);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  color: var(--llamb-text-primary);
  font-family: inherit;
  outline: none;
  transition: all 0.2s;
  box-sizing: border-box;
}

.llamb-input:focus {
  border-color: var(--llamb-user-bubble);
}

.llamb-input::placeholder {
  color: var(--llamb-text-tertiary);
}
```

### Cards and Containers
```css
.llamb-card {
  background: var(--llamb-bg-secondary);
  border: 1px solid var(--llamb-border);
  border-radius: 8px;
  padding: 16px;
}

.llamb-section {
  padding: 20px 24px;
  border-bottom: 1px solid var(--llamb-border);
}
```

### Chips and Tags
```css
.llamb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--llamb-bg-tertiary);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 400;
  color: var(--llamb-text-secondary);
  border: none;
}
```

## Animation Guidelines

### Transitions
```css
/* Standard transition for most interactions */
transition: all 0.15s ease;

/* Longer transitions for layout changes */
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

/* Micro-interactions */
transition: transform 0.1s ease;
```

### Transform Effects
```css
/* Hover lift effect */
.hover-lift:hover {
  transform: translateY(-1px);
}

/* Button press effect */
.btn-active:active {
  transform: translateY(0);
}

/* Scale effects for circular buttons */
.scale-hover:hover {
  transform: scale(1.05);
}
```

## Layout Patterns

### Flex Layouts
```css
/* Standard flex container */
.llamb-flex {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Space-between layout */
.llamb-flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Flex with proper shrinking */
.llamb-flex-item {
  flex: 1;
  min-width: 0;
}

.llamb-flex-no-shrink {
  flex-shrink: 0;
}
```

### Grid Patterns
```css
/* Form grid */
.llamb-form-grid {
  display: grid;
  gap: 16px;
}

/* Two-column form */
.llamb-form-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
```

## Theme Implementation

### CSS Custom Properties
Use CSS custom properties for all colors and spacing to ensure consistent theming:

```css
:root {
  /* Define light mode variables */
}

[data-llamb-theme="dark"] {
  /* Override with dark mode variables */
}
```

### Theme Detection
```javascript
// Detect and apply theme
function detectTheme() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-llamb-theme', isDark ? 'dark' : 'light');
}
```

## Usage Guidelines

1. **Always use CSS custom properties** for colors and spacing
2. **Follow the spacing scale** - don't use arbitrary values
3. **Use system fonts** - avoid custom font imports
4. **No shadows** - use subtle borders for definition
5. **Consistent hover states** - subtle background changes
6. **Maintain aspect ratios** - use proper flex properties
7. **Test in both themes** - ensure proper contrast

## File Organization

```
├── llamb-ui.css          # Core design system styles
├── sidebar.css           # Sidebar-specific styles
├── popup.css            # Popup-specific styles (deprecated)
├── settings.css         # Settings-specific styles (deprecated)
└── components/
    ├── buttons.css      # Button components
    ├── forms.css        # Form components
    └── layout.css       # Layout utilities
```

---

This design system ensures a **clean, professional, and consistent** user experience across all views of the LlamB extension.