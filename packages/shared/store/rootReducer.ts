import { combineReducers } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import ticketsReducer from "./slices/ticketsSlice";
import plotsReducer from "./slices/plotSlice";
import artifactsReducer from "./slices/artifactsSlice";
import loadingReducer from "./slices/loadingSlice";
import filesReducer from "./slices/filesSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  tickets: ticketsReducer,
  plots: plotsReducer,
  artifacts: artifactsReducer,
  loading: loadingReducer,
  files: filesReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
