import { redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ space: string }>;
}) {
  const { space } = await params;
  redirect("/ledgers?" + new URLSearchParams({ space }));
}
