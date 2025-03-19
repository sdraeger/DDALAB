# Help Ticket System

The DDALAB application includes a help ticket system that allows logged-in users to submit support tickets and track their status. This document explains how to set up and use the help ticket system.

## Features

- Help button in the application header for logged-in users
- Ticket submission form with title and description
- Ticket tracking page to view the status of all tickets
- Back-end integration with Directus for ticket storage and management

## Setup

Before using the help ticket system, you need to set up the "help_tickets" collection in Directus.

### 1. Configure Directus Connection

Ensure your Directus connection is properly configured in your `.env.local` file:

```
DIRECTUS_URL=http://localhost:8055
DIRECTUS_EMAIL=admin@example.com
DIRECTUS_PASSWORD=yourpassword
```

### 2. Create the Help Tickets Collection

Run the setup script to create the "help_tickets" collection in Directus:

```bash
npm run setup-tickets
```

This script:
- Creates a new "help_tickets" collection in Directus
- Adds all necessary fields (title, description, status, etc.)
- Sets up proper permissions

### 3. Directus Admin Interface

After setting up the collection, you can manage tickets through the Directus admin interface:
- Log in to Directus at http://localhost:8055/admin
- Navigate to the "help_tickets" collection
- Update ticket status from "open" to "in_progress", "resolved", or "closed"
- Add admin notes to tickets

## Using the Help Ticket System

### For Users

1. **Submitting a Ticket**:
   - Log in to the DDALAB application
   - Click the help icon (life buoy) in the header
   - Fill in the ticket title and description
   - Submit the form

2. **Viewing Tickets**:
   - Navigate to Dashboard → My Tickets (or click "Help Tickets" in the user dropdown)
   - View all your tickets sorted by status
   - Track the progress of your tickets

### For Administrators

1. **Managing Tickets**:
   - Log in to the Directus admin interface
   - Navigate to the "help_tickets" collection
   - Update ticket status
   - Add admin notes
   - Respond to user requests

## API Endpoints

The help ticket system provides the following API endpoints:

- `POST /api/tickets` - Create a new ticket
- `GET /api/tickets` - Get all tickets for the current user
- `GET /api/tickets/[id]` - Get a specific ticket by ID
- `PATCH /api/tickets/[id]` - Update a specific ticket

All endpoints require authentication via a Bearer token.

## Ticket Statuses

Tickets can have the following statuses:

- `open` - Newly created ticket, not yet addressed
- `in_progress` - Ticket is being worked on by support staff
- `resolved` - Issue has been resolved
- `closed` - Ticket has been closed (either resolved or cannot be addressed)

## Testing

### Test Structure

The test suite is organized into the following directories:

- `__tests__/api`: Tests for API mocking and interactions
- `__tests__/unit`: Unit tests for individual components
- `__tests__/integration`: Integration tests for component interactions
- `__tests__/mocks`: Shared mock implementations
- `__tests__/utils`: Test utilities and helpers

### Running Tests

To run tests, use the following commands:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test categories
npm run test:api
npm run test:unit
npm run test:integration
```

### Mocking Strategy

- **API Requests**: Mock Service Worker (MSW) is used to intercept and mock API requests
- **Browser APIs**: Jest mocks for browser APIs like localStorage
- **Next.js Features**: Custom mocks for Next.js features like router

### Coverage

The goal is to maintain high coverage for critical application paths:
- Authentication flows
- Form validation
- Error handling
- Context state management

### Key Integration Tests

The application includes integration tests for the following key user flows:

1. **Authentication**:
   - Login flow (`login-flow.test.tsx`)
   - Registration flow (`register-flow.test.tsx`)

2. **Dashboard Navigation**:
   - Tab switching (`dashboard-navigation.test.tsx`)
   - Content loading for different tabs

3. **Data Visualization**:
   - EEG data visualization (`eeg-visualization.test.tsx`)
   - Chart controls and interactions
   - Data loading and error handling

4. **Help Ticket System**:
   - Ticket submission (`help-ticket.test.tsx`)
   - Form validation
   - API error handling

5. **User Profile Management**:
   - User settings updates (`user-profile.test.tsx`)
   - Preference management
   - Validation and error handling

6. **File Management**:
   - File uploads (`file-upload.test.tsx`)
   - Progress tracking
   - Error handling for invalid files

### Current Test Status

While we have implemented a comprehensive suite of integration tests, some of the newly added tests require additional components and context providers to be implemented before they will pass. The current status is:

- ✅ **Working Tests**:
  - Login flow integration tests
  - Authentication context unit tests
  - Login form unit tests
  - API mocking tests

- 🛠️ **Tests Needing Component Implementation**:
  - Registration flow tests (need `RegisterDialog` component)
  - Dashboard navigation tests (need `EDFPlotProvider` context)
  - EEG visualization tests (need `EEGDashboard` component) 
  - User profile tests (need `UserSettings` component)
  - File upload tests (need `FileUpload` component)
  - Help ticket tests (need `HelpButton` component with proper validation)

These tests serve as a specification for the components that need to be implemented. Once the required components are created, the tests will validate their functionality. 