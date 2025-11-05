import '../globals.css'
import { Toaster } from '@/components/ui/toaster'
import { PopoutInitializer } from '@/components/PopoutInitializer'

export default function PopoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Just return children and let the root layout handle HTML structure
  // This prevents nested HTML elements which cause hydration errors
  return (
    <PopoutInitializer>
      {children}
      <Toaster />
    </PopoutInitializer>
  )
}