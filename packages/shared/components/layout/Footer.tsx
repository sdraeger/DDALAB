"use client";

import { BrainCircuit, Mail, Globe, Github } from "lucide-react";
import { useApiQuery } from "../../hooks/useApiQuery";

interface ConfigResponse {
  institution_name: string;
}

export function Footer() {
  const currentYear = new Date().getFullYear();

  // Use the existing useApiQuery pattern for API calls
  const { data: configData, loading: configLoading, error: configError } = useApiQuery<ConfigResponse>({
    url: "/api/config",
    method: "GET",
    responseType: "json",
    enabled: true, // Always enabled since this doesn't require auth
    // Don't provide token since this endpoint doesn't require auth
  });

  // Debug logging for config fetch
  if (process.env.NODE_ENV === "development") {
    console.log("Footer config debug:", {
      configData,
      configLoading,
      configError,
    });
  }

  const institutionName = configData?.institution_name || "DEFAULT";

  return (
    <footer className="w-full bg-background border-t shadow-sm mt-auto">
      <div className="container mx-auto py-3 px-4">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 mb-3">
            <BrainCircuit className="h-5 w-5 text-foreground" />
            <span className="font-medium text-foreground">DDALAB</span>
          </div>

          <div className="flex justify-center gap-6 mb-3">
            <a
              href="mailto:sdraeger@salk.edu"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Mail className="h-3 w-3" />
              <span>Contact</span>
            </a>
            <a
              href="https://www.salk.edu"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Globe className="h-3 w-3" />
              <span>Website</span>
            </a>
            <a
              href="https://github.com/sdraeger/DDALAB"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Github className="h-3 w-3" />
              <span>GitHub</span>
            </a>
          </div>

          <div className="text-xs text-muted-foreground">
            &copy; {currentYear} DDALAB
            {institutionName ? ` @ ${institutionName}` : ""}. All rights
            reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
