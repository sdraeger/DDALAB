import { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, ExternalLink, Check, X } from 'lucide-react';
import { openNeuroService } from '../services/openNeuroService';
import { open } from '@tauri-apps/plugin-shell';

interface OpenNeuroApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApiKeyUpdated?: () => void;
}

export function OpenNeuroApiKeyDialog({ isOpen, onClose, onApiKeyUpdated }: OpenNeuroApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyPreview, setKeyPreview] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkExistingKey();
    }
  }, [isOpen]);

  const checkExistingKey = async () => {
    try {
      const status = await openNeuroService.checkApiKey();
      setHasExistingKey(status.has_key);
      setKeyPreview(status.key_preview);
    } catch (err) {
      console.error('Failed to check API key:', err);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await openNeuroService.saveApiKey(apiKey.trim());
      setSuccess(true);
      setHasExistingKey(true);
      setApiKey('');
      onApiKeyUpdated?.();

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete your OpenNeuro API key?')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await openNeuroService.deleteApiKey();
      setHasExistingKey(false);
      setKeyPreview(undefined);
      setApiKey('');
      onApiKeyUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenKeyGen = async () => {
    try {
      await open('https://openneuro.org/keygen');
    } catch (error) {
      console.error('Failed to open URL:', error);
      window.open('https://openneuro.org/keygen', '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border rounded-lg shadow-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">OpenNeuro API Key</h2>
        </div>

        <div className="space-y-4">
          {/* Existing key status */}
          {hasExistingKey && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                <span className="font-medium">API Key Configured</span>
              </div>
              {keyPreview && (
                <div className="mt-1 text-xs text-muted-foreground font-mono">
                  {keyPreview}
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              To upload datasets to OpenNeuro, you need an API key. Get one by:
            </p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Logging into OpenNeuro with ORCID or GitHub</li>
              <li>Visiting the API key generation page</li>
              <li>Copying the generated key and pasting it below</li>
            </ol>
          </div>

          {/* Open keygen button */}
          <button
            onClick={handleOpenKeyGen}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors text-sm"
          >
            <ExternalLink className="h-4 w-4" />
            Open OpenNeuro Key Generator
          </button>

          {/* API key input */}
          <div>
            <label className="block text-sm font-medium mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your OpenNeuro API key..."
                className="w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive rounded-lg text-destructive text-sm">
              <X className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary rounded-lg text-primary text-sm">
              <Check className="h-4 w-4" />
              <span>API key saved successfully!</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {hasExistingKey && (
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
              >
                Delete Key
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={loading || !apiKey.trim()}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
            >
              {loading ? 'Saving...' : hasExistingKey ? 'Update Key' : 'Save Key'}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
            >
              Close
            </button>
          </div>

          {/* Security note */}
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            Your API key is stored securely in your system keychain
          </div>
        </div>
      </div>
    </div>
  );
}
