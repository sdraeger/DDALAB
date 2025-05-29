import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: "open" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  assignedTo?: string;
}

export interface TicketsState {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  currentTicket: Ticket | null;
}

const initialState: TicketsState = {
  tickets: [],
  loading: false,
  error: null,
  currentTicket: null,
};

const ticketsSlice = createSlice({
  name: "tickets",
  initialState,
  reducers: {
    setTickets: (state, action: PayloadAction<Ticket[]>) => {
      state.tickets = action.payload;
      state.loading = false;
      state.error = null;
    },
    setCurrentTicket: (state, action: PayloadAction<Ticket | null>) => {
      state.currentTicket = action.payload;
    },
    updateTicketInState: (
      state,
      action: PayloadAction<Partial<Ticket> & { id: string }>
    ) => {
      const index = state.tickets.findIndex((t) => t.id === action.payload.id);
      if (index !== -1) {
        state.tickets[index] = { ...state.tickets[index], ...action.payload };
      }
      if (state.currentTicket?.id === action.payload.id) {
        state.currentTicket = { ...state.currentTicket, ...action.payload };
      }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const {
  setTickets,
  setCurrentTicket,
  updateTicketInState,
  setLoading,
  setError,
} = ticketsSlice.actions;
export default ticketsSlice.reducer;
