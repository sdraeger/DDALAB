import { combineReducers } from "@reduxjs/toolkit";
import plotsReducer from "./slices/plotSlice";

const rootReducer = combineReducers({
  plots: plotsReducer,
  // Add other reducers here as your application grows
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
