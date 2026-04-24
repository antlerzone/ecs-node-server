import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot password | Cleanlemons",
  description: "Request a verification code to reset your Cleanlemons portal password.",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
