/**
 * Deployment Manager Component
 * Main UI for managing DDALAB deployment through ConfigManager
 */

import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Tabs, 
  Tab, 
  Paper, 
  Typography, 
  Alert,
  CircularProgress,
  Button,
  IconButton,
  Tooltip
} from '@mui/material';
import { 
  Settings as SettingsIcon,
  CloudUpload as DeployIcon,
  Update as UpdateIcon,
  History as HistoryIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { DeploymentConfig } from './DeploymentConfig';
import { DeploymentStatus } from './DeploymentStatus';
import { DeploymentUpdates } from './DeploymentUpdates';
import { DeploymentHistory } from './DeploymentHistory';
import { useDeployment } from '../hooks/useDeployment';
import { DeploymentAPI } from '../types/deployment-types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`deployment-tabpanel-${index}`}
      aria-labelledby={`deployment-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const DeploymentManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const deployment = useDeployment();
  
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };
  
  const handleRefresh = () => {
    deployment.refreshStatus();
  };
  
  if (deployment.loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }
  
  if (deployment.error) {
    return (
      <Box p={3}>
        <Alert severity="error">
          <Typography variant="h6">Deployment Error</Typography>
          <Typography>{deployment.error}</Typography>
        </Alert>
      </Box>
    );
  }
  
  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Paper sx={{ width: '100%' }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          borderBottom: 1, 
          borderColor: 'divider',
          px: 2
        }}>
          <Tabs value={activeTab} onChange={handleTabChange}>
            <Tab 
              icon={<DeployIcon />} 
              label="Status" 
              iconPosition="start"
            />
            <Tab 
              icon={<SettingsIcon />} 
              label="Configuration" 
              iconPosition="start"
            />
            <Tab 
              icon={<UpdateIcon />} 
              label="Updates" 
              iconPosition="start"
            />
            <Tab 
              icon={<HistoryIcon />} 
              label="History" 
              iconPosition="start"
            />
          </Tabs>
          
          <Tooltip title="Refresh Status">
            <IconButton onClick={handleRefresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
        
        <TabPanel value={activeTab} index={0}>
          <DeploymentStatus 
            status={deployment.status}
            onDeploy={deployment.deploy}
            onStop={deployment.stop}
            onRestart={deployment.restart}
            onViewLogs={deployment.viewLogs}
          />
        </TabPanel>
        
        <TabPanel value={activeTab} index={1}>
          <DeploymentConfig
            config={deployment.config}
            onSave={deployment.updateConfig}
            onValidate={deployment.validateConfig}
            onBackup={deployment.backupConfig}
          />
        </TabPanel>
        
        <TabPanel value={activeTab} index={2}>
          <DeploymentUpdates
            updateState={deployment.updateState}
            rollbackHistory={deployment.rollbackHistory}
            onCheckUpdate={deployment.checkForUpdates}
            onDownload={deployment.downloadUpdate}
            onInstall={deployment.installUpdate}
            onRollback={deployment.rollback}
          />
        </TabPanel>
        
        <TabPanel value={activeTab} index={3}>
          <DeploymentHistory
            configHistory={deployment.configHistory}
            backups={deployment.backups}
            onRestore={deployment.restoreBackup}
          />
        </TabPanel>
      </Paper>
    </Box>
  );
};