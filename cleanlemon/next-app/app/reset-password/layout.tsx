import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset password | Cleanlemons",
  description: "Enter your verification code and set a new Cleanlemons portal password.",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
