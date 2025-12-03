import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search as SearchIcon, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/**
 * Input component with validation states and accessibility features.
 */
const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A form input component with built-in validation states, error messages, and proper accessibility attributes.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search", "file"],
      description: "The input type",
    },
    validationState: {
      control: "select",
      options: ["default", "error", "success"],
      description: "Visual validation state",
    },
    error: {
      control: "text",
      description: "Error message (also sets validationState to error)",
    },
    placeholder: {
      control: "text",
      description: "Placeholder text",
    },
    disabled: {
      control: "boolean",
      description: "Disables the input",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  args: {
    placeholder: "Enter text...",
  },
};

export const WithLabel: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="name@example.com" />
    </div>
  ),
};

// Types
export const Email: Story = {
  args: {
    type: "email",
    placeholder: "name@example.com",
  },
};

export const Password: Story = {
  args: {
    type: "password",
    placeholder: "Enter password",
  },
};

export const Number: Story = {
  args: {
    type: "number",
    placeholder: "0",
  },
};

export const Search: Story = {
  args: {
    type: "search",
    placeholder: "Search...",
  },
};

export const File: Story = {
  args: {
    type: "file",
  },
};

// Validation states
export const Success: Story = {
  args: {
    validationState: "success",
    defaultValue: "valid@email.com",
  },
};

export const Error: Story = {
  args: {
    validationState: "error",
    defaultValue: "invalid-email",
  },
};

export const WithErrorMessage: Story = {
  args: {
    id: "email-error",
    error: "Please enter a valid email address",
    defaultValue: "not-an-email",
  },
};

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: "Disabled input",
  },
};

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    defaultValue: "This is read-only",
  },
};

// With icons (using wrapper)
export const WithSearchIcon: Story = {
  render: () => (
    <div className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input className="pl-10" placeholder="Search files..." />
    </div>
  ),
};

export const WithMailIcon: Story = {
  render: () => (
    <div className="relative">
      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input className="pl-10" type="email" placeholder="Email address" />
    </div>
  ),
};

// Password with toggle
export const PasswordWithToggle: Story = {
  render: function PasswordToggle() {
    const [showPassword, setShowPassword] = useState(false);
    return (
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type={showPassword ? "text" : "password"}
          className="pl-10 pr-10"
          placeholder="Enter password"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    );
  },
};

// Form example
export const FormExample: Story = {
  render: () => (
    <form className="space-y-4 w-[320px]">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="John Doe" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="form-email">Email</Label>
        <Input id="form-email" type="email" placeholder="john@example.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="form-password">Password</Label>
        <Input
          id="form-password"
          type="password"
          placeholder="Enter password"
        />
      </div>
    </form>
  ),
};

// Validation example
export const ValidationExample: Story = {
  render: () => (
    <div className="space-y-4 w-[320px]">
      <div className="space-y-2">
        <Label htmlFor="valid-input">Valid Input</Label>
        <Input
          id="valid-input"
          validationState="success"
          defaultValue="Looks good!"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invalid-input">Invalid Input</Label>
        <Input
          id="invalid-input"
          error="This field is required"
          defaultValue=""
        />
      </div>
    </div>
  ),
};
