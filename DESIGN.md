---
name: Self Hosted Runner
description: A minimal service homepage using the existing application identity.
colors:
  background: "oklch(20.8% 0.042 265.755)"
  foreground: "oklch(97% 0.005 265)"
  accent: "oklch(79% 0.14 175)"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.4rem + 1.2vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    lineHeight: 1.7
spacing:
  content-gap: "1.25rem"
rounded:
  icon: "0.875rem"
---

# Self Hosted Runner

## Overview

Keep the homepage a small utility surface: the existing icon, application name, one English description, and two resource links.

## Colors

Navy comes from the application icon. White carries the title; secondary text mixes the foreground into the background. Mint identifies links and keyboard focus.

## Typography

Native sans-serif typography keeps this utility page self-contained. Body text is 17px; links are 15px. Headings balance naturally without forced line breaks.

## Layout

A three-track grid centers a content column of up to 31rem. Fluid gutters and wrapping resource links support narrow screens without layout breakpoints. The page centers vertically when space allows and scrolls when needed.

## Components

Resource links have 44px minimum height, underlines, hover and press colors, and a 2px keyboard focus outline. The existing icon also serves as the favicon. No cards, animations, or client-side scripts are needed for this surface.
