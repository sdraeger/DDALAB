# DDALAB E2E Test Suite

This directory contains comprehensive end-to-end tests for the DDALAB application, focusing on larger application features and user workflows.

## Test Structure

### Test Files

- `01-file-selection-workflow.spec.ts` - File selection and state propagation
- `02-dda-analysis-workflow.spec.ts` - Complete DDA analysis workflow including variant selection
- `03-widget-interactions.spec.ts` - Widget state management and inter-widget communication
- `04-system-integration.spec.ts` - Backend API integration and system connectivity
- `05-performance-monitoring.spec.ts` - Performance metrics and resource usage
- `06-error-handling.spec.ts` - Error handling and edge cases

### Page Objects

- `pages/BasePage.ts` - Base page class with common functionality
- `pages/LoginPage.ts` - Login page interactions
- `pages/DashboardPage.ts` - Main dashboard and widget interactions

### Utilities

- `global.setup.ts` - Global test setup and authentication
- `test-runner.ts` - Test execution script with proper cleanup

## Running Tests

### Prerequisites

1. Ensure the DDALAB application is running:
   ```bash
   # In the project root
   npm run dev
   ```

2. Install Playwright browsers:
   ```bash
   cd packages/web20
   npm run test:e2e:install
   ```

### Basic Usage

```bash
# Run all E2E tests
npm run test:e2e

# Run with visible browser (headed mode)
npm run test:e2e -- --headed

# Run specific test file
npm run test:e2e -- 01-file-selection-workflow.spec.ts

# Run on specific browser
npm run test:e2e -- --project=firefox

# Debug mode (opens debugger)
npm run test:e2e:debug

# Interactive UI mode
npm run test:e2e:ui
```

### Advanced Usage

```bash
# Run with custom options
npm run test:e2e -- --browser chromium --workers 2 --retries 1

# Run specific tests matching pattern
npm run test:e2e -- --grep "file selection"

# Generate and view test report
npm run test:e2e -- --reporter=html
```

## Test Categories

### 1. File Selection Workflow Tests
- Dashboard loads with all widgets
- File selection updates global state
- Widget state synchronization
- File browser navigation
- Channel selection persistence
- Responsive layout maintenance

### 2. DDA Analysis Workflow Tests
- DDA variant loading and display
- Complete analysis workflow (file → configure → run → results)
- Input validation
- Variant selection handling
- Progress indication and results display
- Cross-widget result broadcasting

### 3. Widget Interaction Tests
- Global state change propagation
- Widget drag and drop (if implemented)
- Widget resizing (if implemented)
- Plot widget updates
- State maintenance during navigation
- Concurrent operations handling
- Error state management

### 4. System Integration Tests
- Backend API connectivity
- DDA variants API integration
- Network failure handling
- Authentication state management
- Session persistence
- Multi-user session isolation
- Resource constraint handling
- WebSocket connections (if used)
- File system operations

### 5. Performance Monitoring Tests
- Dashboard load time measurement
- Large file operation efficiency
- Memory usage monitoring
- API response time tracking
- Widget rendering performance
- User interaction responsiveness
- Network request efficiency
- Resource utilization validation

### 6. Error Handling Tests
- Application startup failure recovery
- Invalid file path/format handling
- Malformed channel configuration handling
- Server error recovery (4xx, 5xx)
- Browser compatibility testing
- Rapid user interaction handling
- Edge case data format handling
- Memory pressure scenarios
- Operation interruption handling
- Meaningful error message display

## Configuration

### Environment Variables

- `CI` - Set to enable CI-specific configurations
- `PLAYWRIGHT_WORKERS` - Override worker count
- `PLAYWRIGHT_RETRIES` - Override retry count
- `PLAYWRIGHT_TIMEOUT` - Override test timeout

### Browser Configuration

Tests run on multiple browsers by default:
- Chromium (Desktop Chrome)
- Firefox
- WebKit (Safari)
- Mobile Chrome (Pixel 5)
- Mobile Safari (iPhone 12)

### Test Data

Tests assume the presence of sample EDF files for testing. Ensure your test environment has:
- `sample.edf` - Basic test file
- `large-sample.edf` - For performance testing (optional)
- Test folders for navigation testing

## CI/CD Integration

### CircleCI Configuration

The tests are designed to run in CircleCI with proper:
- Browser installation
- Application startup verification
- Parallel execution
- Result reporting
- Artifact collection

### Local Development

For local development:
1. Start the application in development mode
2. Run tests with `--headed` to see browser interactions
3. Use `--debug` for step-by-step debugging
4. Use `--ui` for interactive test development

## Troubleshooting

### Common Issues

1. **Application not responding**
   - Ensure DDALAB is running on correct port
   - Check for SSL certificate issues
   - Verify environment variables

2. **Tests timing out**
   - Increase timeout with `--timeout` flag
   - Check for slow network responses
   - Ensure adequate system resources

3. **Browser crashes**
   - Update Playwright browsers
   - Check system memory availability
   - Reduce worker count if needed

4. **Flaky tests**
   - Check for race conditions
   - Add appropriate wait conditions
   - Verify test data availability

### Debug Tips

1. Use `--headed` to watch tests run
2. Add `page.pause()` in test code for breakpoints
3. Check browser console logs in test output
4. Use Playwright trace viewer for failed tests
5. Enable video recording for complex issues

## Best Practices

1. **Test Independence**: Each test should be able to run independently
2. **Data Cleanup**: Tests should not leave persistent state
3. **Realistic Scenarios**: Focus on real user workflows
4. **Error Scenarios**: Include negative test cases
5. **Performance Awareness**: Monitor resource usage
6. **Browser Compatibility**: Test across different browsers
7. **Maintainability**: Use Page Object Model for better organization