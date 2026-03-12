/**
 * Root layout — SSS Issuer Dashboard
 *
 * Uses Radix Themes (not shadcn/Tailwind like PR #40) for a clean design-system
 * with built-in dark mode, spacing system, and accessible components.
 */
import type { Metadata }     from "next";
import { Theme }              from "@radix-ui/themes";
import { WalletContextProvider } from "../components/WalletProvider";
import "@radix-ui/themes/styles.css";

export const metadata: Metadata = {
  title:       "SSS Issuer Dashboard",
  description: "Solana Stablecoin Standard — Operator Interface",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Theme
          appearance="dark"
          accentColor="cyan"
          grayColor="slate"
          radius="medium"
          scaling="95%"
        >
          <WalletContextProvider>
            {children}
          </WalletContextProvider>
        </Theme>
      </body>
    </html>
  );
}
