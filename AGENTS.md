<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Required UI standards

Before changing application pages or components, read [the UX audit](docs/ux-audit.md). Preserve the user's 8px spacing grid, 3–5 navigation destinations, core three-click paths, 4.5:1 text contrast, one primary action, 65ch prose measure, single-column visibly labelled forms, 80ms hover feedback, 48px touch targets with 8px gaps, 16px body/input text, and the mobile bottom navigation/action space. Keep destructive actions outside the primary action area and preserve confirmations.

Run the relevant lint/type checks and UX regression/browser checks. Do not claim full WCAG certification or real-device verification from Chromium measurements alone. Provider-hosted screens are outside this app's styling scope.
