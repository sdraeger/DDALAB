"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { HelpCircle, Mail, Globe, Github } from "lucide-react";
import { BrainCircuit } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { submitSignupForm } from "./actions";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  affiliation: z.string().min(1, "Affiliation is required"),
  email: z.string().email("Invalid email address"),
});

type FormValues = z.infer<typeof formSchema>;

export default function SignUpForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingUserError, setExistingUserError] = useState<string | null>(
    null
  );
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      affiliation: "",
      email: "",
    },
  });

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    setExistingUserError(null);

    try {
      const result = await submitSignupForm(data);

      if (result.success) {
        console.log("Success!", result);
        form.reset();
        console.log("Form reset");
        toast({
          title: "Success!",
          description: "Your interest in DDALAB has been recorded.",
          variant: "default",
        });
        console.log("Toast shown");
      } else if (result.error) {
        // Handle the case where the user already exists
        setExistingUserError(result.error);
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          "There was a problem submitting your information. Please try again.",
        variant: "destructive",
      });
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="w-full p-4 bg-white shadow-sm">
        <div className="container mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-10 w-10 text-gray-900" />
              <span className="font-bold text-xl text-gray-900">DDALAB</span>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <button className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors duration-200 px-3 py-1.5 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300">
                  <HelpCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">About</span>
                </button>
              </DialogTrigger>
              <DialogContent className="bg-white text-gray-900 max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-xl font-semibold text-gray-900">
                    About DDALAB
                  </DialogTitle>
                </DialogHeader>
                <div className="text-gray-600 mt-2 space-y-4">
                  <div className="mb-4">
                    This website is used to record interest in using DDALAB. By
                    submitting this form, you are expressing your interest in
                    our services and allowing us to contact you with more
                    information.
                  </div>
                  <div>
                    DDALAB provides advanced data analysis and research tools
                    for academic and professional use.
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="flex-1 flex justify-center items-center p-4">
        <Card className="w-full max-w-md bg-white">
          <CardHeader className="bg-white text-gray-900">
            <CardTitle className="text-2xl font-bold text-gray-900">
              Sign Up
            </CardTitle>
            <CardDescription className="text-gray-600">
              Please fill out the form below to express your interest in DDALAB.
            </CardDescription>
          </CardHeader>
          <CardContent className="bg-white">
            {existingUserError && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Already Registered</AlertTitle>
                <AlertDescription>{existingUserError}</AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem className="text-gray-900">
                        <FormLabel className="text-gray-700">
                          First Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="John"
                            {...field}
                            className="bg-white border-gray-300 text-gray-900"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem className="text-gray-900">
                        <FormLabel className="text-gray-700">
                          Last Name
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Doe"
                            {...field}
                            className="bg-white border-gray-300 text-gray-900"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500" />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="affiliation"
                  render={({ field }) => (
                    <FormItem className="text-gray-900">
                      <FormLabel className="text-gray-700">
                        Affiliation
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="University or Organization"
                          {...field}
                          className="bg-white border-gray-300 text-gray-900"
                        />
                      </FormControl>
                      <FormMessage className="text-red-500" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="text-gray-900">
                      <FormLabel className="text-gray-700">Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john.doe@example.com"
                          {...field}
                          className="bg-white border-gray-300 text-gray-900"
                        />
                      </FormControl>
                      <FormMessage className="text-red-500" />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full bg-black hover:bg-gray-800 text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>

      <footer className="w-full bg-white shadow-sm mt-auto">
        <div className="container mx-auto py-6 px-4">
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 mb-6">
              <BrainCircuit className="h-6 w-6 text-gray-700" />
              <span className="font-medium text-gray-700">DDALAB</span>
            </div>

            <div className="flex justify-center gap-8 mb-6">
              <a
                href="#"
                className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm"
              >
                <Mail className="h-4 w-4" />
                <span>Contact</span>
              </a>
              <a
                href="#"
                className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm"
              >
                <Globe className="h-4 w-4" />
                <span>Website</span>
              </a>
              <a
                href="#"
                className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm"
              >
                <Github className="h-4 w-4" />
                <span>GitHub</span>
              </a>
            </div>

            <div className="text-sm text-gray-500">
              &copy; {currentYear} DDALAB. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
