import { redirect } from "next/navigation"

export default async function HomedemoSlugRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params
  redirect("/home")
}
