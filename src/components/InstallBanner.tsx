import { useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

export function InstallBanner() {
  const { canPrompt, isIOS, install, dismiss } = useInstallPrompt();
  const [showIOSSteps, setShowIOSSteps] = useState(false);

  if (!canPrompt) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-content">
        <div className="install-banner-text">
          <strong>Install NightStack</strong>
          <span className="text-secondary text-sm">
            {isIOS ? 'Add to your home screen for the best experience' : 'Install for quick access and offline use'}
          </span>
        </div>
        <div className="install-banner-actions">
          {isIOS ? (
            <button className="btn btn-primary btn-sm" onClick={() => setShowIOSSteps(s => !s)}>
              How to Install
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={install}>
              Install
            </button>
          )}
          <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">
            &times;
          </button>
        </div>
      </div>
      {isIOS && showIOSSteps && (
        <div className="install-ios-steps">
          <ol>
            <li>Tap the <strong>Share</strong> button in Safari's toolbar</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Add</strong> to confirm</li>
          </ol>
        </div>
      )}
    </div>
  );
}
