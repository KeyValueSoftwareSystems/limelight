"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LibraryPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/shows?new=1"); }, [router]);
  return null;
}
