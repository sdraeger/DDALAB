// import { NextRequest, NextResponse } from "next/server";
// import userAuth from "@/lib/db/user-auth";

// // Define types for our user and token
// interface User {
//   id: number;
//   username: string;
//   email: string;
//   first_name?: string;
//   last_name?: string;
//   is_admin: boolean;
// }

// interface TokenResult {
//   id: number;
//   token: string;
//   description: string;
//   expires_at: Date;
//   created_at: Date;
// }

// /**
//  * POST /api/auth/login
//  * Endpoint to authenticate a user and generate an access token
//  */
// export async function POST(request: NextRequest) {
//   try {
//     // Extract credentials from request body
//     const { username, password } = await request.json();

//     // Validate required fields
//     if (!username || !password) {
//       return NextResponse.json(
//         { error: "Username and password are required" },
//         { status: 400 }
//       );
//     }

//     // Authenticate user
//     const user = (await userAuth.authenticateUser(
//       username,
//       password
//     )) as User | null;

//     if (!user) {
//       return NextResponse.json(
//         { error: "Invalid username or password" },
//         { status: 401 }
//       );
//     }

//     // Generate a token for the authenticated user
//     const tokenResult = (await userAuth.createUserToken(
//       user.id,
//       "Web App Access",
//       7
//     )) as TokenResult;

//     // Return the user and token
//     return NextResponse.json({
//       user,
//       token: tokenResult.token,
//       expires_at: tokenResult.expires_at,
//     });
//   } catch (error) {
//     console.error("Login error:", error);
//     return NextResponse.json(
//       { error: "Authentication failed" },
//       { status: 500 }
//     );
//   }
// }

// /**
//  * POST /api/auth/register
//  * Endpoint to register a new user
//  */
// export async function PUT(request: NextRequest) {
//   try {
//     // Extract user data from request body
//     const userData = await request.json();
//     const { username, password, email, firstName, lastName } = userData;

//     // Validate required fields
//     if (!username || !password || !email) {
//       return NextResponse.json(
//         { error: "Username, password, and email are required" },
//         { status: 400 }
//       );
//     }

//     // Register the new user
//     try {
//       const newUser = await userAuth.registerUser({
//         username,
//         password,
//         email,
//         firstName,
//         lastName,
//       });

//       return NextResponse.json({ user: newUser });
//     } catch (dbError: any) {
//       // Handle duplicate username/email errors
//       if (dbError.code === "23505") {
//         // PostgreSQL unique violation error code
//         if (dbError.detail?.includes("username")) {
//           return NextResponse.json(
//             { error: "Username already exists" },
//             { status: 409 }
//           );
//         } else if (dbError.detail?.includes("email")) {
//           return NextResponse.json(
//             { error: "Email already exists" },
//             { status: 409 }
//           );
//         }
//       }

//       throw dbError;
//     }
//   } catch (error) {
//     console.error("Registration error:", error);
//     return NextResponse.json({ error: "Registration failed" }, { status: 500 });
//   }
// }

// /**
//  * POST /api/auth/verify
//  * Endpoint to verify a token and get the associated user
//  */
// export async function PATCH(request: NextRequest) {
//   try {
//     // Extract token from request body
//     const { token } = await request.json();

//     if (!token) {
//       return NextResponse.json({ error: "Token is required" }, { status: 400 });
//     }

//     // Validate the token
//     const user = await userAuth.validateToken(token);

//     if (!user) {
//       return NextResponse.json(
//         { error: "Invalid or expired token" },
//         { status: 401 }
//       );
//     }

//     // Return the user associated with the token
//     return NextResponse.json({ user });
//   } catch (error) {
//     console.error("Token verification error:", error);
//     return NextResponse.json(
//       { error: "Token verification failed" },
//       { status: 500 }
//     );
//   }
// }

// /**
//  * POST /api/auth/logout
//  * Endpoint to revoke a token
//  */
// export async function DELETE(request: NextRequest) {
//   try {
//     // Extract token from request body
//     const { token } = await request.json();

//     if (!token) {
//       return NextResponse.json({ error: "Token is required" }, { status: 400 });
//     }

//     // Revoke the token
//     const success = await userAuth.revokeToken(token);

//     if (!success) {
//       return NextResponse.json({ error: "Token not found" }, { status: 404 });
//     }

//     return NextResponse.json({ message: "Logged out successfully" });
//   } catch (error) {
//     console.error("Logout error:", error);
//     return NextResponse.json({ error: "Logout failed" }, { status: 500 });
//   }
// }
