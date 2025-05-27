import { combineReducers } from "@reduxjs/toolkit";
import authReducer from "../src/store/slices/authSlice";
import ticketsReducer from "../src/store/slices/ticketsSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  tickets: ticketsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
