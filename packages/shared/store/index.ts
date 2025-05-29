import { configureStore } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import authReducer from "./slices/authSlice";
import ticketsReducer from "./slices/ticketsSlice";

import { combineReducers } from "@reduxjs/toolkit";
import { TicketsState } from "./slices/ticketsSlice";

export * from "./slices/authSlice";
export * from "./slices/ticketsSlice";

export const rootReducer = combineReducers({
  tickets: ticketsReducer,
});

export type RootState = {
  tickets: TicketsState;
};

export const store = configureStore({
  reducer: {
    auth: authReducer,
    tickets: ticketsReducer,
  },
  devTools: process.env.NODE_ENV !== "production",
});

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
