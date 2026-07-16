import type { Metadata } from "next";

import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Privacy Notice | sello",
  description:
    "Privacy notice for sello resale listing and marketplace connection tools.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-10">
        <header className="border-b border-zinc-800 pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-300">
            Privacy
          </p>
          <h1 className="mt-3 text-3xl font-semibold">sello Privacy Notice</h1>
          <p className="mt-3 text-sm text-zinc-400">Last updated: May 31, 2026</p>
        </header>

        <section className="space-y-4 text-sm leading-6 text-zinc-300">
          <p>
            sello helps users create and manage resale listings, prepare listing
            drafts, and connect marketplace accounts. This notice describes the
            data the app handles for those workflows. It is not a final
            production privacy policy and should be reviewed before a public
            launch.
          </p>

          <h2 className="text-xl font-semibold text-zinc-100">Data We Handle</h2>
          <p>
            The app may handle account email and authentication data through
            Supabase, item photos uploaded by the user, listing drafts and
            inventory data, marketplace connection data, AI-generated listing
            metadata, and basic logs or error details used for debugging.
          </p>
          <p>
            When a user connects eBay, eBay OAuth tokens are stored encrypted
            server-side. Tokens are used to connect the user&apos;s eBay account,
            check seller readiness, and publish or manage listings only when the
            user explicitly chooses those actions.
          </p>

          <h2 className="text-xl font-semibold text-zinc-100">
            Marketplace Connections
          </h2>
          <p>
            eBay connection data is not sold and is not shown publicly. Users
            can disconnect eBay from marketplace settings. Disconnecting removes
            the stored connection used by the app for eBay readiness checks and
            listing actions.
          </p>

          <h2 className="text-xl font-semibold text-zinc-100">AI Metadata</h2>
          <p>
            AI-generated listing metadata is used to help prepare drafts for the
            user to review. Users should verify generated descriptions,
            categories, pricing suggestions, and item details before using them.
          </p>

          <h2 className="text-xl font-semibold text-zinc-100">Contact</h2>
          <p>
            For privacy or support questions, email{" "}
            <a className="underline underline-offset-4" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
              {PUBLIC_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
