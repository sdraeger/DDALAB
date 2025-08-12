export interface Layout {
  i: string; // Unique identifier for the layout item
  x: number; // X position
  y: number; // Y position
  w: number; // Width
  h: number; // Height
}

export interface LayoutCreate {
  layouts: Layout[];
}

export interface LayoutResponse {
  status: string;
  message: string;
}
