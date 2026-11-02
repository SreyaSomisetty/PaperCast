"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { USE_MOCKS } from "@/lib/config";

const MockGate = dynamic(() => import("./MockGate"), { ssr: false });

export function MockProvider({ children }: { children: ReactNode }) {
  return USE_MOCKS ? <MockGate>{children}</MockGate> : children;
}
