"use client";

import { ClientOnly } from "@/components/ClientOnly";
import dynamic from "next/dynamic";

const PhaseSpacePopout = dynamic(
  () => import("@/components/popout/PhaseSpacePopout"),
  { ssr: false },
);

export default function PhaseSpacePopoutPage() {
  return (
    <ClientOnly>
      <PhaseSpacePopout />
    </ClientOnly>
  );
}
