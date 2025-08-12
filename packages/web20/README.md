# DDALAB Dashboard

A modern, modular dashboard application built with Next.js, featuring arrangeable widgets, advanced state management, and a beautiful UI.

## Features

### 🎯 Core Features

- **Modular State Management**: Uses both Redux Toolkit and Zustand for optimal performance
- **Arrangeable Widgets**: Drag-and-drop widgets with grid snapping and collision detection
- **Responsive Layout**: Header, sidebar, and footer with toggle controls
- **Theme Support**: Light, dark, and system theme modes
- **Widget Management**: Minimize, maximize, pop-out, and remove widgets

### 🏗️ Architecture

- **SOLID Principles**: Clean, maintainable code following software engineering best practices
- **TypeScript**: Full type safety throughout the application
- **Component Modularity**: Reusable UI components with proper separation of concerns
- **State Management**:
  - Redux Toolkit for global app state (user preferences, UI state)
  - Zustand for dashboard-specific state (widgets, layouts, interactions)

### 🎨 UI/UX

- **Modern Design**: Clean, professional interface with smooth animations
- **Accessibility**: ARIA-compliant components with keyboard navigation
- **Responsive**: Works seamlessly across different screen sizes
- **Customizable**: Theme switching and layout preferences

## Technology Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with custom design system
- **State Management**:
  - Redux Toolkit for global state
  - Zustand for local state
- **UI Components**: Radix UI primitives with custom components
- **Icons**: Lucide React
- **Build Tool**: Turbopack (Next.js built-in)

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Main dashboard page
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── layout/           # Layout components (Header, Sidebar, Footer)
│   ├── dashboard/        # Dashboard-specific components
│   └── ui/              # Reusable UI components
├── store/               # State management
│   ├── slices/          # Redux Toolkit slices
│   ├── zustand/         # Zustand stores
│   └── providers/       # Store providers
├── types/               # TypeScript type definitions
├── lib/                 # Utility functions
└── hooks/               # Custom React hooks
```

## State Management Architecture

### Redux Toolkit (Global State)

- **User Preferences**: Theme, sidebar state, header/footer visibility
- **Authentication**: User data, login state
- **App Settings**: Global configuration

### Zustand (Local State)

- **Dashboard State**: Widgets, layouts, current selection
- **Interaction State**: Drag, resize, selection states
- **Performance**: Optimized for frequent updates

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm

### Installation

1. **Install Dependencies**

   ```bash
   cd packages/web20
   npm install
   ```

2. **Start Development Server**

   ```bash
   npm run dev
   ```

3. **Open Browser**
   Navigate to `http://localhost:3001`

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test` - Run tests

## Widget System

### Widget Types

- **Chart Widget**: Data visualization components
- **Data Table**: Tabular data display
- **Metrics**: Key performance indicators

### Widget Features

- **Drag & Drop**: Move widgets around the dashboard
- **Resize**: Adjust widget dimensions
- **Minimize/Maximize**: Collapse or expand widgets
- **Pop Out**: Open widgets in separate windows
- **Grid Snapping**: Align widgets to grid
- **Collision Detection**: Prevent widget overlap

## Customization

### Adding New Widgets

1. Create widget component in `src/components/widgets/`
2. Add widget type to `src/types/dashboard.ts`
3. Register widget in the sidebar
4. Implement widget-specific logic

### Theme Customization

- Modify CSS variables in `src/app/globals.css`
- Add new theme variants in Tailwind config
- Update theme toggle in Header component

### State Management

- Add new Redux slices in `src/store/slices/`
- Create Zustand stores in `src/store/zustand/`
- Update type definitions as needed

## Performance Optimizations

- **React.memo**: Optimized component re-renders
- **useCallback/useMemo**: Prevent unnecessary recalculations
- **Zustand**: Efficient state updates with minimal re-renders
- **Lazy Loading**: Code splitting for better initial load times
- **Virtual Scrolling**: For large datasets (planned)

## Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Deployment

### Build for Production

```bash
npm run build
```

### Docker Deployment

### Building the Docker Image

To build the Next.js application's Docker image, run the following command from the project root:

```bash
docker build -t ddalab-monolith .
```

This will create a Docker image tagged `ddalab-monolith`.

### Running with Docker Compose

Make sure you have Docker Compose installed. From the project root, you can start the application:

```bash
docker compose up -d
```

This will start the Next.js frontend, Python API, PostgreSQL, MinIO, and Redis services.

### Local Development with Docker

For local development, you can run the application using Docker Compose as described above. The `docker-compose.yml` is configured to allow hot-reloading for both the frontend and backend when running in development mode.

### Environment Variables

The web20 app uses a single, centralized environment configuration:

- Single source: root `/.env` loaded via `dotenv` in package scripts
- Access in code via `src/lib/env.ts` (do not read `process.env` directly)

To change API URL or other public values, edit `/.env` (e.g., `NEXT_PUBLIC_API_URL`).

## Contributing

1. Follow SOLID principles
2. Write clean, modular code
3. Add TypeScript types for all new features
4. Include tests for new functionality
5. Update documentation as needed

## License

This project is part of the DDALAB ecosystem and follows the same licensing terms.

---

Built with ❤️ using modern web technologies and best practices.
