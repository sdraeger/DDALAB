"use client";

import { ClientOnly } from "@/components/ClientOnly";
import dynamic from "next/dynamic";

const FileViewerPopout = dynamic(
  () => import("@/components/popout/FileViewerPopout"),
  { ssr: false },
);

export default function FileViewerPopoutPage() {
  return (
    <ClientOnly>
      <FileViewerPopout />
    </ClientOnly>
  );
}
