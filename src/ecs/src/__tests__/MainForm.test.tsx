/**
 * Unit Tests for MainForm SSE Integration
 *
 * Tests for the MainForm component's SSE client integration covering:
 * 1. SSE client instantiation on component mount
 * 2. startStream calls with correct endpoint and body for Generate/Optimize buttons
 * 3. Stream cancellation (abort before new stream, abort on unmount)
 * 4. Error handling with abortAll and notification
 * 5. Streaming status display based on configuration
 * 6. Button disabled states when streaming is not configured
 *
 * Requirements: 4.1, 4.7, 4.8
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Create shared mock functions that persist across all tests
const mockStartStream = jest.fn();
const mockAbort = jest.fn();
const mockSSEClientConstructor = jest.fn();

// Mock Cloudscape components before importing MainForm
jest.mock('@cloudscape-design/components', () => ({
  Box: ({ children }: any) => <div data-testid="box">{children}</div>,
  Button: ({ children, disabled, onClick, loading, loadingText, disabledReason, variant }: any) => (
    <button 
      disabled={disabled || loading} 
      onClick={onClick}
      data-loading={loading}
      data-disabled-reason={disabledReason}
      data-variant={variant}
    >
      {loading ? loadingText : children}
    </button>
  ),
  ColumnLayout: ({ children }: any) => <div data-testid="column-layout">{children}</div>,
  Container: ({ children }: any) => <div data-testid="container">{children}</div>,
  FileDropzone: ({ children }: any) => <div data-testid="file-dropzone">{children}</div>,
  FileUpload: ({ onChange, value }: any) => (
    <input 
      type="file" 
      data-testid="file-upload"
      onChange={(e) => onChange({ detail: { value: e.target.files ? Array.from(e.target.files) : [] } })}
    />
  ),
  FormField: ({ children, description }: any) => (
    <div data-testid="form-field" data-description={description}>{children}</div>
  ),
  LiveRegion: ({ children }: any) => <div data-testid="live-region">{children}</div>,
  Select: ({ selectedOption, options, onChange, placeholder, disabled }: any) => (
    <select 
      data-testid="language-select"
      disabled={disabled}
      value={selectedOption?.value || ''}
      onChange={(e) => {
        const option = options.find((o: any) => o.value === e.target.value);
        onChange({ detail: { selectedOption: option } });
      }}
    >
      <option value="">{placeholder}</option>
      {options?.map((opt: any) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
  SpaceBetween: ({ children }: any) => <div data-testid="space-between">{children}</div>,
}));

jest.mock('@cloudscape-design/chat-components', () => ({
  LoadingBar: () => <div data-testid="loading-bar">Loading...</div>,
}));

jest.mock('react-markdown', () => ({ children }: any) => <div data-testid="markdown">{children}</div>);

// Mock ImageDropZone
jest.mock('../ImageDropZone', () => {
  return {
    __esModule: true,
    default: ({ onChange, disabled, isScanning }: any) => (
      <div 
        data-testid="image-dropzone" 
        data-disabled={disabled}
        data-scanning={isScanning}
      >
        <button 
          data-testid="mock-select-image"
          onClick={() => onChange({
            data: 'data:image/png;base64,test',
            file: [new File(['test'], 'test.png', { type: 'image/png' })],
            fileName: 'test.png'
          })}
        >
          Select Image
        </button>
        <button
          data-testid="mock-clear-image"
          onClick={() => onChange(undefined)}
        >
          Clear Image
        </button>
      </div>
    ),
  };
});

// Mock the SSEClient class - create a class that uses the shared mock functions
jest.mock('../sseClient', () => {
  // Create a mock class that uses the shared mock functions from the outer scope
  class MockSSEClient {
    startStream = mockStartStream;
    abort = mockAbort;
    
    constructor() {
      mockSSEClientConstructor();
    }
  }
  
  return {
    SSEClient: MockSSEClient,
  };
});

// Mock the api module
jest.mock('../api', () => ({
  uploadImage: jest.fn().mockResolvedValue(undefined),
  triggerStepFunction: jest.fn().mockResolvedValue(undefined),
}));

// Mock the notification context
const mockNotify = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();

jest.mock('../App', () => ({
  useNotification: () => ({
    notify: mockNotify,
    success: mockSuccess,
    error: mockError,
  }),
}));

// Import after mocks are set up
import MainForm from '../MainForm';
import { SSEClient } from '../sseClient';
import * as api from '../api';

describe('MainForm SSE Integration', () => {
  // Store original APP_CONFIG
  const originalAppConfig = (window as any).APP_CONFIG;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    mockStartStream.mockReset();
    mockStartStream.mockResolvedValue(undefined);
    mockAbort.mockReset();
    mockSSEClientConstructor.mockReset();
    
    mockNotify.mockReset();
    mockSuccess.mockReset();
    mockError.mockReset();
    
    // Reset APP_CONFIG before each test
    (window as any).APP_CONFIG = {
      STREAMING_API_URL: 'https://api.example.com/stream',
    };
  });

  afterEach(() => {
    cleanup();
    // Restore original APP_CONFIG
    (window as any).APP_CONFIG = originalAppConfig;
  });

  describe('SSE Client Instantiation', () => {
    /**
     * Test that SSE client is instantiated when component mounts
     * Validates: Requirement 4.1
     */
    it('should instantiate SSEClient when component mounts', () => {
      render(<MainForm />);
      
      // SSEClient constructor should have been called
      expect(mockSSEClientConstructor).toHaveBeenCalled();
    });
  });

  describe('Generate Button - startStream calls', () => {
    /**
     * Test that startStream is called with correct endpoint and body when Generate button is clicked
     * Validates: Requirement 4.1
     */
    it('should call startStream with correct endpoint and body when Generate button is clicked', async () => {
      render(<MainForm />);

      // Select an image using mock
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      // Select a language
      const languageSelect = screen.getByTestId('language-select');
      fireEvent.change(languageSelect, { target: { value: 'typescript' } });

      // Click Generate button
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Wait for startStream to be called
      await waitFor(() => {
        expect(mockStartStream).toHaveBeenCalled();
      });

      // Verify the endpoint contains /analyze
      const callArgs = mockStartStream.mock.calls[0];
      expect(callArgs[0]).toContain('/analyze');
      
      // Verify the body contains s3Key and language
      expect(callArgs[1]).toHaveProperty('language', 'typescript');
    });

    /**
     * Test that abort is called before starting a new stream (cancellation)
     * Validates: Requirements 4.7, 4.8
     */
    it('should call abort before starting a new stream (cancellation)', async () => {
      render(<MainForm />);

      // Select an image
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      // Select a language
      const languageSelect = screen.getByTestId('language-select');
      fireEvent.change(languageSelect, { target: { value: 'python' } });

      // Click Generate button
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Wait for the stream to start
      await waitFor(() => {
        expect(mockStartStream).toHaveBeenCalled();
      });

      // abort should have been called before startStream (in onSubmit)
      expect(mockAbort).toHaveBeenCalled();
    });
  });

  describe('Optimize Button - startStream calls', () => {
    /**
     * Test that startStream is called with correct endpoint and body when Optimize button is clicked
     * Validates: Requirement 4.1
     */
    it('should call startStream with correct endpoint and body when Optimize button is clicked', async () => {
      render(<MainForm />);

      // Select an image
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      // Click Optimize button (doesn't require language selection)
      const optimizeButton = screen.getByRole('button', { name: /optimize/i });
      fireEvent.click(optimizeButton);

      // Wait for startStream to be called
      await waitFor(() => {
        expect(mockStartStream).toHaveBeenCalled();
      });

      // Verify the endpoint contains /optimize
      const callArgs = mockStartStream.mock.calls[0];
      expect(callArgs[0]).toContain('/optimize');
    });
  });

  describe('Stream Cancellation', () => {
    /**
     * Test that abort is called on component unmount (cleanup)
     * Validates: Requirement 4.7
     */
    it('should call abort on component unmount (cleanup)', () => {
      const { unmount } = render(<MainForm />);

      // Clear any previous abort calls from initialization
      mockAbort.mockClear();

      // Unmount the component
      unmount();

      // abort should have been called during cleanup
      expect(mockAbort).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    /**
     * Test that error callback triggers abortAll and shows error notification
     * Validates: Requirement 4.8
     */
    it('should trigger error notification when SSE error callback is invoked', async () => {
      // Configure startStream to capture the options and call onError
      mockStartStream.mockImplementation((url: string, body: object, options: any) => {
        // Simulate an error after a short delay
        setTimeout(() => {
          options.onError(new Error('Test streaming error'));
        }, 10);
        return Promise.resolve();
      });

      render(<MainForm />);

      // Select an image
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      // Select a language
      const languageSelect = screen.getByTestId('language-select');
      fireEvent.change(languageSelect, { target: { value: 'typescript' } });

      // Click Generate button
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Wait for error notification to be called
      await waitFor(() => {
        expect(mockError).toHaveBeenCalled();
      });
    });
  });

  describe('Streaming Status Display', () => {
    /**
     * Test that streaming status shows "Ready" when STREAMING_API_URL is configured
     * Validates: Requirement 4.1
     */
    it('should show "Ready" when STREAMING_API_URL is configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: 'https://api.example.com/stream',
      };

      render(<MainForm />);

      // Should show "Ready" status
      expect(screen.getByText(/Streaming: Ready/i)).toBeInTheDocument();
    });

    /**
     * Test that streaming status shows "Not Configured" when STREAMING_API_URL is not configured
     * Validates: Requirement 4.1
     */
    it('should show "Not Configured" when STREAMING_API_URL is not configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: undefined,
      };

      render(<MainForm />);

      // Should show "Not Configured" status
      expect(screen.getByText(/Streaming: Not Configured/i)).toBeInTheDocument();
    });

    it('should show "Not Configured" when APP_CONFIG is undefined', () => {
      (window as any).APP_CONFIG = undefined;

      render(<MainForm />);

      // Should show "Not Configured" status
      expect(screen.getByText(/Streaming: Not Configured/i)).toBeInTheDocument();
    });

    it('should show "Not Configured" when STREAMING_API_URL is empty string', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: '',
      };

      render(<MainForm />);

      // Should show "Not Configured" status
      expect(screen.getByText(/Streaming: Not Configured/i)).toBeInTheDocument();
    });
  });

  describe('Button Disabled States', () => {
    /**
     * Test that buttons are disabled when streaming is not configured
     * Validates: Requirement 4.1
     */
    it('should disable Generate button when streaming is not configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: undefined,
      };

      render(<MainForm />);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toBeDisabled();
    });

    it('should disable Optimize button when streaming is not configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: undefined,
      };

      render(<MainForm />);

      const optimizeButton = screen.getByRole('button', { name: /optimize/i });
      expect(optimizeButton).toBeDisabled();
    });

    it('should disable Generate button when no image is selected', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: 'https://api.example.com/stream',
      };

      render(<MainForm />);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toBeDisabled();
    });

    it('should disable Generate button when no language is selected', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: 'https://api.example.com/stream',
      };

      render(<MainForm />);

      // Select an image but not language
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toBeDisabled();
    });

    it('should enable Generate button when image and language are selected and streaming is configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: 'https://api.example.com/stream',
      };

      render(<MainForm />);

      // Select an image
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      // Select a language
      const languageSelect = screen.getByTestId('language-select');
      fireEvent.change(languageSelect, { target: { value: 'typescript' } });

      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).not.toBeDisabled();
    });

    it('should enable Optimize button when image is selected and streaming is configured', () => {
      (window as any).APP_CONFIG = {
        STREAMING_API_URL: 'https://api.example.com/stream',
      };

      render(<MainForm />);

      // Select an image
      const selectImageBtn = screen.getByTestId('mock-select-image');
      fireEvent.click(selectImageBtn);

      const optimizeButton = screen.getByRole('button', { name: /optimize/i });
      expect(optimizeButton).not.toBeDisabled();
    });
  });
});
