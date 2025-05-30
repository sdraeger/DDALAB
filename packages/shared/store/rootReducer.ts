import { combineReducers } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import ticketsReducer from "./slices/ticketsSlice";
import plotsReducer from "./slices/plotSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  tickets: ticketsReducer,
  plots: plotsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
