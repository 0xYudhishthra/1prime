# Unite DeFi

A DeFi protocol built with pnpm and bun.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v8.15.0 or higher)
- [bun](https://bun.sh/) (v1.0.0 or higher)

## Installation

1. Install pnpm globally (if not already installed):
   ```bash
   npm install -g pnpm@8.15.0
   ```

2. Install bun (if not already installed):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

## Development

- **Start development server**: `pnpm dev`
- **Run tests**: `pnpm test`
- **Build project**: `pnpm build`
- **Lint code**: `pnpm lint`
- **Format code**: `pnpm format`

## Project Structure

```
unite-defi/
├── src/           # Source code
├── packages/      # Workspace packages
├── apps/          # Applications
├── test/          # Test files
├── dist/          # Build output
└── docs/          # Documentation
```

## Workspace Configuration

This project uses pnpm workspaces for monorepo management. The workspace is configured in `pnpm-workspace.yaml` and supports:

- Multiple packages in `packages/`
- Multiple applications in `apps/`
- Shared dependencies and tooling

## Bun Integration

Bun is used for:
- Fast TypeScript execution
- Testing with built-in test runner
- Bundling with `bun build`
- Package management (configured to use pnpm)

## Scripts

- `dev`: Start development server with hot reload
- `start`: Run the application
- `build`: Build the project for production
- `test`: Run tests using bun
- `lint`: Lint TypeScript files
- `format`: Format code with Prettier 