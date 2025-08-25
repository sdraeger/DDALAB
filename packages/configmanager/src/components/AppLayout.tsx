import React from 'react';
import { ProgressSidebar, SimplifiedControlSidebar } from './';

interface AppLayoutProps {
  isSetupComplete: boolean;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  currentSite: string;
  setupType?: string;
  electronAPI: any;
  userSelections: any;
  onNewSetup: () => void;
  onShowUpdateModal: () => void;
  onShowHealthDetails?: () => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  isSetupComplete,
  sidebarExpanded,
  onToggleSidebar,
  currentSite,
  setupType,
  electronAPI,
  userSelections,
  onNewSetup,
  onShowUpdateModal,
  onShowHealthDetails,
  children,
}) => {
  return (
    <div className="app-layout">
      {isSetupComplete ? (
        <SimplifiedControlSidebar
          isExpanded={sidebarExpanded}
          onToggle={onToggleSidebar}
          electronAPI={electronAPI}
          userSelections={userSelections}
          onNewSetup={onNewSetup}
          onShowUpdateModal={onShowUpdateModal}
          onShowHealthDetails={onShowHealthDetails}
        />
      ) : (
        <ProgressSidebar
          currentSite={currentSite}
          setupType={setupType}
          isExpanded={sidebarExpanded}
          onToggle={onToggleSidebar}
          electronAPI={electronAPI}
          isSetupComplete={isSetupComplete}
        />
      )}
      <div
        className={`main-content ${
          sidebarExpanded ? 'with-sidebar' : 'with-collapsed-sidebar'
        }`}
      >
        <div className="installer-container">{children}</div>
      </div>
      <style>{`
        .app-layout {
          display: flex;
          height: 100vh;
          overflow: hidden;
        }

        .main-content {
          flex: 1;
          overflow-y: auto;
          transition: margin-left 0.3s ease;
        }

        .main-content.with-sidebar {
          margin-left: ${isSetupComplete ? '280px' : '280px'};
        }

        .main-content.with-collapsed-sidebar {
          margin-left: 50px;
        }

        .installer-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 20px;
        }
      `}</style>
    </div>
  );
};