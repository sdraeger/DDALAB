import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DDAWidget } from './DDAWidget';
import { SessionProvider } from 'next-auth/react';

// Mock the hooks
jest.mock('@/hooks/useUnifiedSession', () => ({
  useUnifiedSessionData: () => ({ data: { accessToken: 'mock-token' } })
}));

jest.mock('@/hooks/useCurrentFileSubscription', () => ({
  useCurrentFileInfo: () => ({
    currentFilePath: 'test.edf',
    currentPlotState: {
      selectedChannels: ['Ch1', 'Ch2', 'Ch3'],
      edfData: { channel_labels: ['Ch1', 'Ch2', 'Ch3', 'Ch4'] }
    }
  }),
  useCurrentFileSubscription: () => {}
}));

jest.mock('@/lib/api', () => ({
  default: {
    setToken: jest.fn(),
    request: jest.fn()
  }
}));

describe('DDAWidget', () => {
  it('should initialize with all channels selected from plot state', () => {
    render(
      <SessionProvider session={null}>
        <DDAWidget />
      </SessionProvider>
    );

    // Check that channel selection shows
    expect(screen.getByText('Channels (3/4)')).toBeInTheDocument();

    // Check that channels are displayed
    expect(screen.getByLabelText('Ch1')).toBeInTheDocument();
    expect(screen.getByLabelText('Ch2')).toBeInTheDocument();
    expect(screen.getByLabelText('Ch3')).toBeInTheDocument();
    expect(screen.getByLabelText('Ch4')).toBeInTheDocument();

    // Check that initially selected channels are checked
    expect(screen.getByLabelText('Ch1')).toBeChecked();
    expect(screen.getByLabelText('Ch2')).toBeChecked();
    expect(screen.getByLabelText('Ch3')).toBeChecked();
    expect(screen.getByLabelText('Ch4')).not.toBeChecked();
  });

  it('should allow selecting and deselecting channels for DDA', () => {
    render(
      <SessionProvider session={null}>
        <DDAWidget />
      </SessionProvider>
    );

    // Deselect Ch2
    fireEvent.click(screen.getByLabelText('Ch2'));
    expect(screen.getByText('Channels (2/4)')).toBeInTheDocument();

    // Select Ch4
    fireEvent.click(screen.getByLabelText('Ch4'));
    expect(screen.getByText('Channels (3/4)')).toBeInTheDocument();
  });

  it('should have select all and clear buttons', () => {
    render(
      <SessionProvider session={null}>
        <DDAWidget />
      </SessionProvider>
    );

    // Click None
    fireEvent.click(screen.getByText('None'));
    expect(screen.getByText('Channels (0/4)')).toBeInTheDocument();

    // Click All
    fireEvent.click(screen.getByText('All'));
    expect(screen.getByText('Channels (4/4)')).toBeInTheDocument();
  });

  it('should show error if no channels selected when running DDA', () => {
    render(
      <SessionProvider session={null}>
        <DDAWidget />
      </SessionProvider>
    );

    // Clear all selections
    fireEvent.click(screen.getByText('None'));

    // Try to run DDA
    fireEvent.click(screen.getByText('Run DDA'));

    // Check for error message
    expect(screen.getByText('Please select at least one channel for DDA processing')).toBeInTheDocument();
  });
});
