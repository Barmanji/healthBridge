"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "next-themes";

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();
  return <Sonner position="top-right" richColors theme={theme as ToasterProps["theme"]} {...props} />;
}
