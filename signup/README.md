# DDA Access Signup Form

A modern web application for handling DDA access requests. This application provides a user-friendly form for submitting access requests and automatically notifies administrators via email.

## Features

- Clean, modern UI built with React and Material-UI
- Form validation
- Email notifications for administrators
- Responsive design

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:
Create a `.env` file in the server directory with the following variables:

```bash
ADMIN_EMAIL=your-admin-email@example.com
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
```

## Development

To run the frontend development server:

```bash
npm start
```

The application will be available at <http://localhost:3000>

## Building for Production

To create a production build:

```bash
npm run build
```

## Backend Integration

The frontend is designed to work with the FastAPI backend. Make sure the backend server is running and properly configured with the email settings.
