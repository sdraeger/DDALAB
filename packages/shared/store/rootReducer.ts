import { combineReducers } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import ticketsReducer from "./slices/ticketsSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  tickets: ticketsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
