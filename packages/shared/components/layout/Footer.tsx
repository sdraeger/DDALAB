"use client";

import { BrainCircuit, Mail, Globe, Github } from "lucide-react";
import { useApiQuery } from "../../hooks/useApiQuery";

interface ConfigResponse {
  institutionName: string;
}

export function Footer() {
  const currentYear = new Date().getFullYear();

  const { data: configData, loading: configLoading } = useApiQuery<ConfigResponse>({
    url: "/api/config",
    method: "GET",
    responseType: "json",
    enabled: true,
  });

  const institutionName = configData?.institutionName;

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
            {institutionName && !configLoading ? ` @ ${institutionName}` : ""}. All rights
            reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
