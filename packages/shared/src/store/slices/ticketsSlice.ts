import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
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

export const fetchTickets = createAsyncThunk(
  'tickets/fetchTickets',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) {
        throw new Error('Failed to fetch tickets');
      }
      return await response.json();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return rejectWithValue(errorMessage);
    }
  }
);

const ticketsSlice = createSlice({
  name: 'tickets',
  initialState,
  reducers: {
    setTickets: (state, action: PayloadAction<Ticket[]>) => {
      state.tickets = action.payload;
    },
    setCurrentTicket: (state, action: PayloadAction<Ticket | null>) => {
      state.currentTicket = action.payload;
    },
    updateTicketInState: (state, action: PayloadAction<Partial<Ticket> & { id: string }>) => {
      const index = state.tickets.findIndex(t => t.id === action.payload.id);
      if (index !== -1) {
        state.tickets[index] = { ...state.tickets[index], ...action.payload };
      }
      if (state.currentTicket?.id === action.payload.id) {
        state.currentTicket = { ...state.currentTicket, ...action.payload };
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTickets.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTickets.fulfilled, (state, action) => {
        state.loading = false;
        state.tickets = action.payload;
      })
      .addCase(fetchTickets.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const { setTickets, setCurrentTicket, updateTicketInState } = ticketsSlice.actions;
export default ticketsSlice.reducer;
