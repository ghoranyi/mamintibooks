# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page mobile webapp for managing book inventory at **Maminti Kucko**, a Hungarian children's bookshop. Used on a phone with the camera for barcode scanning. UI is in Hungarian.

Two flows:
- **Add**: scan ISBN barcode → fetch metadata from Google Books → enter quantity → save.
- **Sell**: scan ISBN barcode → decrement that title's qty by 1.

A third tab (**Készlet** / Inventory) lists current stock and supports CSV export.

## Architecture

Plain static site — no build, no framework, no bundler. Three files do everything:

- `index.html` — markup for all three tabs in one document; tabs are toggled via a CSS `.active` class, no routing.
- `styles.css` — Maminti Kucko branding (soft pink `#F4C2CC`, sage green `#C7E0B5`, cream `#FFFCF7`, bold black outlines `#1A1A1A`). Mobile-first, max-width 560px.
- `app.js` — all logic. No modules; everything is top-level in one IIFE-free script.

Key dependencies (CDN, no install):
- `html5-qrcode` for camera barcode scanning. Supports EAN-13 (the format on book ISBNs), EAN-8, UPC, CODE-128.
- Google Books API (`https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn>`) — no key required.

State lives in `localStorage` under key `mk_inventory_v1`. Shape: `{ [isbn]: { isbn, title, authors, cover, qty, addedAt, ... } }`. The ISBN is the primary key — adding the same ISBN twice increments qty rather than creating duplicates.

## Camera / scanner notes

- `Html5Qrcode` requires HTTPS to access the camera (localhost is also OK). Plain `file://` won't work for camera, but works fine for testing the rest of the UI.
- Two scanner instances exist (`scanners.add`, `scanners.sell`); switching tabs calls `stopScanner()` for both to release the camera.
- On successful decode, the scanner is stopped *before* the result is forwarded — don't call lookup or save while the camera is still running.

## Running locally

No build step. Either:
- Open `index.html` directly (everything works except the camera).
- Serve over HTTPS (e.g. `npx serve` + a tunnel, or deploy to Netlify/Vercel/GitHub Pages) to test scanning on a phone.

## Conventions

- All user-facing strings are Hungarian. Keep it that way unless asked otherwise.
- The branding palette and bold-outline button style is intentional — match the existing look when adding UI.
- Don't introduce a build step, framework, or package manager unless explicitly asked. The "no install, just open the file" property is a feature.
