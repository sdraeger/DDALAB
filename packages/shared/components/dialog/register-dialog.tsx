"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useSession } from "next-auth/react";

// Schema for invite code step
const inviteCodeSchema = z.object({
  code: z.string().min(6, "Invite code must be at least 6 characters"),
  email: z.string().email("Please enter a valid email").optional(),
});

// Schema for registration step
const registerSchema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type InviteCodeFormValues = z.infer<typeof inviteCodeSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;

interface RegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterDialog({ open, onOpenChange }: RegisterDialogProps) {
  // Current step: 'invite' or 'register'
  const [step, setStep] = useState<"invite" | "register">("invite");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validInviteCode, setValidInviteCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState("");

  const { data: session, status } = useSession();
  const isLoading = status === "loading";

  // Form for invite code step
  const inviteForm = useForm<InviteCodeFormValues>({
    resolver: zodResolver(inviteCodeSchema),
    defaultValues: {
      code: "",
      email: "",
    },
  });

  // Form for registration step
  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
    },
  });

  // Make sure username field is reset when moving to register step
  useEffect(() => {
    if (step === "register") {
      // Completely reset the register form to ensure it's fresh
      registerForm.reset({
        username: "",
        password: "",
        confirmPassword: "",
        firstName: "",
        lastName: "",
      });
      // Reset our directly controlled username
      setUsername("");
    }
  }, [step, registerForm]);

  // Custom handler to ensure username field doesn't default to invite code
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    registerForm.setValue("username", value);
  };

  // Validate invite code
  async function onInviteSubmit(data: InviteCodeFormValues) {
    setLoading(true);
    setError(null);

    try {
      // const isValid = await validateInviteCode(
      //   data.code,
      //   data.email || undefined
      // );
      const isValid = true; // TODO: implement invite code validation

      if (isValid) {
        setValidInviteCode(data.code);
        if (data.email) {
          setEmail(data.email);
        }

        // Reset username field
        setUsername("");
        registerForm.setValue("username", "");

        setStep("register");
      } else {
        setError("Invalid invite code. Please try again.");
      }
    } catch (err) {
      setError("An error occurred while validating the invite code.");
    } finally {
      setLoading(false);
    }
  }

  // Handle registration manually without relying on form submission
  async function handleRegister() {
    if (!validInviteCode) {
      setError("Missing invite code. Please start again.");
      setStep("invite");
      return;
    }

    // Validate username field
    if (!username || username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    // Validate email field
    if (!email) {
      setError("Email address is required");
      return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    // Get form values manually
    const password = registerForm.getValues("password");
    const confirmPassword = registerForm.getValues("confirmPassword");
    const firstName = registerForm.getValues("firstName");
    const lastName = registerForm.getValues("lastName");

    // Validate password
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    // Validate password confirmation
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          email,
          firstName,
          lastName,
          inviteCode: validInviteCode,
        }),
      });

      if (!response.ok) throw new Error("Registration failed");

      // After successful registration, attempt to sign in
      const signInResult = await signIn("credentials", {
        redirect: false,
        username,
        password,
      });

      if (signInResult?.error) throw new Error(signInResult.error);

      onOpenChange(false); // Close dialog on success
    } catch (err: any) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Reset state when dialog closes
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      // Reset forms and state when dialog closes
      inviteForm.reset();
      registerForm.reset();
      setStep("invite");
      setError(null);
      setValidInviteCode(null);
      setEmail(null);
      setUsername("");
    }
    onOpenChange(newOpen);
  }

  // Defensive check - if username somehow equals invite code, clear it
  useEffect(() => {
    if (validInviteCode && username === validInviteCode) {
      setUsername("");
    }
  }, [username, validInviteCode]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {step === "invite" ? "Enter Invite Code" : "Create Account"}
          </DialogTitle>
          <DialogDescription>
            {step === "invite"
              ? "Enter your invite code to register for an account."
              : "Complete your registration details."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {step === "invite" ? (
          <Form {...inviteForm}>
            <form
              onSubmit={inviteForm.handleSubmit(onInviteSubmit)}
              className="space-y-4"
            >
              <FormField
                control={inviteForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invite Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your invite code" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={inviteForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="your@email.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify Code
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <Form {...registerForm}>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                // Prevent default form submission
                e.preventDefault();
              }}
            >
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Choose a Username
                </label>
                <Input
                  id="username"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  placeholder="Enter your desired username"
                  className="w-full"
                  required
                />
                {username.length > 0 && username.length < 3 && (
                  <p className="text-sm text-red-500">
                    Username must be at least 3 characters
                  </p>
                )}
              </div>

              {!email ? (
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={email || ""}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="your@email.com"
                    className="w-full"
                    required
                  />
                </div>
              ) : (
                <div className="text-sm bg-blue-50 p-2 rounded border border-blue-200">
                  Email: {email}
                </div>
              )}

              <FormField
                control={registerForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={registerForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={registerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="First name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={registerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Last name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("invite")}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={loading}
                  onClick={handleRegister}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Register
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
