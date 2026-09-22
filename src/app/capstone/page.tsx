import type { Metadata } from "next";
import { Capstone } from "./Capstone";

export const metadata: Metadata = { title: "Capstone" };

export default function Page() {
  return <Capstone />;
}
