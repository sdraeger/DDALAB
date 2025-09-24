import '../globals.css'
import { Toaster } from '@/components/ui/toaster'

export default function PopoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Just return children and let the root layout handle HTML structure
  // This prevents nested HTML elements which cause hydration errors
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}