import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const user = await userAuth.authenticateUser(username, password);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const tokenResult = await userAuth.createUserToken(
      user.id,
      "Web App Access",
      7
    );
    return NextResponse.json({
      user,
      token: tokenResult.token,
      expires_at: tokenResult.expires_at,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
