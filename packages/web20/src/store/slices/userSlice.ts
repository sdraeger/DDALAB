import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { UserPreferences, DashboardSettings } from '@/types/dashboard';

interface UserState {
  preferences: UserPreferences;
  isAuthenticated: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  sidebarCollapsed: boolean;
  headerVisible: boolean;
  footerVisible: boolean;
  theme: 'light' | 'dark' | 'system';
}

const defaultSettings: DashboardSettings = {
  gridSize: 10,
  enableSnapping: true,
  enableCollisionDetection: true,
  enableAnimations: true,
  theme: 'system',
};

const initialState: UserState = {
  preferences: {
    dashboardSettings: defaultSettings,
    sidebarCollapsed: false,
    headerVisible: true,
    footerVisible: true,
  },
  isAuthenticated: false,
  user: null,
  sidebarCollapsed: false,
  headerVisible: true,
  footerVisible: true,
  theme: 'system',
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<UserState['user']>) => {
      state.user = action.payload;
      state.isAuthenticated = !!action.payload;
    },
    
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.isAuthenticated = action.payload;
    },
    
    updatePreferences: (state, action: PayloadAction<Partial<UserPreferences>>) => {
      state.preferences = { ...state.preferences, ...action.payload };
    },
    
    updateDashboardSettings: (state, action: PayloadAction<Partial<DashboardSettings>>) => {
      state.preferences.dashboardSettings = { 
        ...state.preferences.dashboardSettings, 
        ...action.payload 
      };
    },
    
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      state.preferences.sidebarCollapsed = state.sidebarCollapsed;
    },
    
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
      state.preferences.sidebarCollapsed = action.payload;
    },
    
    toggleHeader: (state) => {
      state.headerVisible = !state.headerVisible;
      state.preferences.headerVisible = state.headerVisible;
    },
    
    setHeaderVisible: (state, action: PayloadAction<boolean>) => {
      state.headerVisible = action.payload;
      state.preferences.headerVisible = action.payload;
    },
    
    toggleFooter: (state) => {
      state.footerVisible = !state.footerVisible;
      state.preferences.footerVisible = state.footerVisible;
    },
    
    setFooterVisible: (state, action: PayloadAction<boolean>) => {
      state.footerVisible = action.payload;
      state.preferences.footerVisible = action.payload;
    },
    
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.theme = action.payload;
      state.preferences.dashboardSettings.theme = action.payload;
    },
    
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    },
  },
});

export const {
  setUser,
  setAuthenticated,
  updatePreferences,
  updateDashboardSettings,
  toggleSidebar,
  setSidebarCollapsed,
  toggleHeader,
  setHeaderVisible,
  toggleFooter,
  setFooterVisible,
  setTheme,
  logout,
} = userSlice.actions;

export default userSlice.reducer; 