# DDALAB Electron App

This is the Electron version of the DDALAB web application. It provides a desktop experience with the same functionality as the web app.

## Development

To start the development environment:

1. Install dependencies:

```bash
pnpm install
```

2. Start the development server:

```bash
pnpm dev
```

This will:

- Start the Electron app in development mode
- Connect to the Next.js development server
- Enable hot reloading
- Open DevTools for debugging

## Building

To build the application:

```bash
pnpm build
```

This will:

- Compile TypeScript files
- Build the Next.js application
- Package the Electron app
- Create installers in the `release` directory

## Project Structure

```
src/
  ├── main/           # Main process files
  │   ├── main.ts     # Main entry point
  │   └── preload.ts  # Preload script
  ├── types/          # TypeScript type definitions
  └── renderer/       # Renderer process (Next.js app)
```

## Features

- All features from the web app
- Local storage using electron-store
- Auto-updates using electron-updater
- Secure IPC communication
- Native system integration

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
