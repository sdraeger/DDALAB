import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

interface InviteCodeValidation {
  valid: boolean;
  message?: string;
  email?: string;
}

export async function GET(request: NextRequest) {
  try {
    // Extract the invite code and optional email from query parameters
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const email = searchParams.get("email") || undefined;

    if (!code) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 }
      );
    }

    // Validate the invite code
    const isValid = (await userAuth.validateInviteCode(
      code,
      email
    )) as InviteCodeValidation;

    if (!isValid.valid) {
      return NextResponse.json(
        {
          valid: false,
          message: isValid.message || "Invalid or expired invite code",
        },
        { status: 200 }
      );
    }

    // All checks passed, invite code is valid
    return NextResponse.json(
      {
        valid: true,
        message: isValid.message || "Invite code is valid",
        email: isValid.email || null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error validating invite code:", error);
    return NextResponse.json(
      { error: "Failed to validate invite code" },
      { status: 500 }
    );
  }
}
