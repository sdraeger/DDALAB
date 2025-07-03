import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";

interface StatsResponse {
  totalArtifacts: number;
  totalAnalyses: number;
  activeUsers: number;
  systemHealth: "excellent" | "good" | "fair" | "poor";
}

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // For now, return mock data. In a real implementation, you would:
    // 1. Query the database for actual artifact counts
    // 2. Check system health metrics
    // 3. Count active user sessions
    // 4. Calculate analysis statistics

    const stats: StatsResponse = {
      totalArtifacts: Math.floor(Math.random() * 1000) + 50, // Mock data
      totalAnalyses: Math.floor(Math.random() * 500) + 25, // Mock data
      activeUsers: Math.floor(Math.random() * 10) + 1, // Mock data
      systemHealth: getRandomSystemHealth(),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard statistics" },
      { status: 500 }
    );
  }
}

function getRandomSystemHealth(): "excellent" | "good" | "fair" | "poor" {
  const healthStates = ["excellent", "good", "fair", "poor"] as const;
  // Bias towards better health states
  const weights = [0.5, 0.3, 0.15, 0.05];
  const random = Math.random();

  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random <= cumulative) {
      return healthStates[i];
    }
  }

  return "good"; // fallback
}
