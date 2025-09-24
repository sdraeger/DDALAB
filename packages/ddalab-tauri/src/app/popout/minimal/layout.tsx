export default function MinimalPopoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Just return the children - let the parent popout layout handle HTML structure
  return <>{children}</>
}