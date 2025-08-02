# ConfigManager Development Guide

This guide explains how to run the ConfigManager application in development mode with hot reloading.

## 🚀 Quick Start

### Option 1: Using the Project Scripts (Recommended)

From the DDALAB project root:

```bash
# Start in development mode with hot reloading
npm run dev:configmanager

# Or start in production mode
npm run start:configmanager
```

### Option 2: Using the Shell Scripts

From the DDALAB project root:

```bash
# On macOS/Linux
./scripts/dev-configmanager.sh

# On Windows
scripts\dev-configmanager.bat
```

### Option 3: Direct Navigation

```bash
# Navigate to the configmanager directory
cd packages/configmanager

# Install dependencies (if not already installed)
npm install

# Start development mode
npm run dev
```

## 🔧 Development Mode Features

When running in development mode (`npm run dev`), you get:

- **Hot Reloading**: Changes to source files automatically restart the Electron app
- **Source Maps**: Better debugging experience with TypeScript source maps
- **Fast Builds**: Uses esbuild for rapid compilation
- **Live Updates**: See changes immediately without manual restarts

## 📁 Project Structure

```
packages/configmanager/
├── src/
│   ├── main.ts              # Main Electron process
│   ├── renderer.tsx         # React renderer process
│   ├── components/          # React components
│   ├── ipc/                 # IPC handlers
│   ├── utils/               # Utility functions
│   └── configmanager.html   # Main HTML file
├── preload.ts               # Preload script
├── esbuild.config.mjs       # Build configuration
├── package.json             # Dependencies and scripts
└── tsconfig.json           # TypeScript configuration
```

## 🛠️ Available Scripts

### Development Scripts

- `npm run dev` - Start development mode with hot reloading
- `npm run build` - Build the application for production
- `npm start` - Build and start the application
- `npm run watch` - Watch for TypeScript changes

### Build Scripts

- `npm run package` - Package the application for distribution
- `npm run package:win` - Package for Windows
- `npm run package:mac` - Package for macOS
- `npm run package:linux` - Package for Linux

### Code Quality Scripts

- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

## 🔍 Debugging

### Development Console

The application runs in development mode with:
- Full console logging
- Source maps for debugging
- Hot reloading for rapid development

### Debugging Tips

1. **Main Process Debugging**: Use `console.log()` in `src/main.ts`
2. **Renderer Process Debugging**: Use browser dev tools (F12)
3. **IPC Debugging**: Check the console for IPC communication logs
4. **Build Issues**: Check the esbuild output for compilation errors

### Common Issues

1. **Port Already in Use**:
   ```bash
   # Check what's using the port
   lsof -i :3000
   # Kill the process
   kill -9 <PID>
   ```

2. **Dependencies Not Installed**:
   ```bash
   cd packages/configmanager
   npm install
   ```

3. **Build Errors**:
   ```bash
   # Clean and rebuild
   rm -rf dist/
   npm run build
   ```

## 🎯 Development Workflow

1. **Start Development**:
   ```bash
   npm run dev:configmanager
   ```

2. **Make Changes**: Edit files in `src/` directory

3. **See Changes**: The app automatically reloads

4. **Test Features**: Use the ConfigManager interface

5. **Stop Development**: Press `Ctrl+C` in the terminal

## 📦 Building for Production

```bash
# Build the application
npm run build

# Start the built application
npm start

# Package for distribution
npm run package
```

## 🔧 Configuration

### Environment Variables

- `NODE_ENV=development` - Enables development features
- `ELECTRON_IS_DEV=true` - Enables Electron development mode

### Build Configuration

The build process is configured in `esbuild.config.mjs`:

- **Main Process**: `src/main.ts` → `dist/main.js`
- **Renderer Process**: `src/renderer.tsx` → `dist/src/renderer.bundle.js`
- **Preload Script**: `preload.ts` → `dist/preload.js`

## 🚀 Deployment

### Local Testing

```bash
# Build and test locally
npm run build
npm start
```

### Distribution

```bash
# Package for your platform
npm run package

# Or package for specific platform
npm run package:mac
npm run package:win
npm run package:linux
```

## 📚 Additional Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://reactjs.org/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
- [esbuild Documentation](https://esbuild.github.io/)

## 🤝 Contributing

1. Make your changes in the `src/` directory
2. Test with `npm run dev:configmanager`
3. Build and test with `npm run build && npm start`
4. Package and test the distribution with `npm run package`

---

**Happy coding! 🎉** 