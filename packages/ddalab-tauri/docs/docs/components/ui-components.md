---
sidebar_position: 2
---

# UI Components

Core UI primitives used throughout DDALAB.

## Button

Primary interaction element with variants and loading states.

```tsx
import { Button } from '@/components/ui/button';

<Button variant="default">Click me</Button>
<Button variant="destructive">Delete</Button>
<Button isLoading>Saving...</Button>
```

**Variants:** default, secondary, destructive, outline, ghost, link

**Sizes:** default, sm, lg, icon

## Input

Form input with validation states.

```tsx
import { Input } from '@/components/ui/input';

<Input placeholder="Enter text..." />
<Input error="Required field" />
<Input validationState="success" />
```

## Card

Content container with header and footer.

```tsx
import { Card, CardHeader, CardContent } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
</Card>;
```

## Dialog

Modal dialog for user interactions.

```tsx
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent>Dialog content</DialogContent>
</Dialog>;
```

## Tabs

Content organization into sections.

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>;
```

## Full Documentation

View all components with interactive examples by running Storybook locally:

```bash
npm run storybook
```

This opens the component playground at http://localhost:6006
