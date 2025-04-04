import { FC } from "react";
import { BrainCircuit, Mail, Globe, Github } from "lucide-react";

const Footer: FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-background border-t shadow-sm mt-auto">
      <div className="container mx-auto py-6 px-4">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 mb-6">
            <BrainCircuit className="h-6 w-6 text-foreground" />
            <span className="font-medium text-foreground">DDALAB</span>
          </div>

          <div className="flex justify-center gap-8 mb-6">
            <a
              href="mailto:sdraeger@salk.edu"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Mail className="h-4 w-4" />
              <span>Contact</span>
            </a>
            <a
              href="https://www.salk.edu"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Globe className="h-4 w-4" />
              <span>Website</span>
            </a>
            <a
              href="https://github.com/sdraeger/DDALAB"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Github className="h-4 w-4" />
              <span>GitHub</span>
            </a>
          </div>

          <div className="text-sm text-muted-foreground">
            &copy; {currentYear} DDALAB
            {process.env.INSTITUTION_NAME
              ? ` @ ${process.env.INSTITUTION_NAME}`
              : ""}
            . All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
