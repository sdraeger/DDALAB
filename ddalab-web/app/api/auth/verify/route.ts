import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

export async function PATCH(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const user = await userAuth.validateToken(token);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Token verification error:", error);
    return NextResponse.json(
      { error: "Token verification failed" },
      { status: 500 }
    );
  }
}
