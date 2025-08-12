import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  try {
    const response = await fetch(`${apiUrl}/config`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch config from API: ${response.statusText}`
      );
    }
    const config = await response.json();
    return NextResponse.json(config);
  } catch (error) {
    console.error("Error fetching API config:", error);
    return NextResponse.json(
      { error: "Failed to load API config" },
      { status: 500 }
    );
  }
}
